import json
import boto3
import os
import time
import traceback

# from boto3.dynamodb.conditions import Attr
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["TABLE_NAME"])
endpoint_url = os.environ["MANAGEMENT_API_URL"]

apigw = boto3.client("apigatewaymanagementapi", endpoint_url=endpoint_url)

CHANNEL_INDEX = os.environ.get("CHANNEL_INDEX_NAME", "ByChannelIndex")

CONNECTION_TTL_SECONDS = int(
    os.environ.get("CONNECTION_TTL_SECONDS", 3600)
)  # default 1 hour


def log(*args, **kwargs):
    print(*args, **kwargs)


def handler(event, context):
    """
    Main Lambda handler for API Gateway WebSocket routes.
    Handles:
      - $connect
      - $disconnect
      - sendMessage (custom route)
    """
    try:

        log("EVENT:", json.dumps(event))

        route = event.get("requestContext", {}).get("routeKey")

        if route == "$connect":
            return on_connect(event)

        if route == "$disconnect":
            return on_disconnect(event)

        return on_send_message(event)
    except Exception as e:
        log("ERROR in handler:", str(e))
        traceback.print_exc()
        return {"statusCode": 500, "body": "Internal server error"}


# ---------------------------
# 1. Handle Connect
# ---------------------------
def on_connect(event):
    request_ctx = event.get("requestContext", {})
    connection_id = request_ctx.get("connectionId")
    qs = event.get("queryStringParameters") or {}
    channel = qs.get("channel")

    log("$connect for connectionId:", connection_id, "queryStringParameters", qs)
    if not channel:
        log("Missing channel param on connect, rejecting")
        return {"statusCode": 400, "body": "Missing channel query param"}

    # caculate ttl (time to live)
    expires_at = int(time.time()) + CONNECTION_TTL_SECONDS

    # Write to DynamoDB
    try:
        table.put_item(
            Item={
                "connectionId": connection_id,
                "channel": channel,
                "expiresAt": expires_at,
            }
        )
        log(
            f"Put connection '{connection_id} -> channel {channel} with ttl {expires_at}"
        )
    except Exception as e:
        log("DynamoDB put_item error:", str(e))
        traceback.print_exc()
        return {"statusCode": 500, "body": "DB error on connect"}

    # Notify peers in same channel that a new peer joined
    notify_peers_of_event(
        channel, connection_id, {"sys": "peer_joined", "connectionId": connection_id}
    )
    return {"statusCode": 200, "body": "Connected"}


# ---------------------------
# 2. Handle Disconnect
# ---------------------------
def on_disconnect(event):
    request_ctx = event.get("requestContext", {})
    connection_id = request_ctx.get("connectionId")
    log("$disconnect for", connection_id)

    # try to get channel from item before deleting (so we can notify peer)
    try:
        resp = table.get_item(Key={"connectionId": connection_id})
        item = resp.get("Item")
        channel = item.get("channel") if item else None
    except Exception as e:
        log("DDB get_item error on disconnect:", e)
        channel = None

    # delete the connection
    try:
        table.delete_item(Key={"connectionId": connection_id})
        log("Deleted connection record", connection_id)
    except Exception as e:
        log("DDB delete_item error:", e)
        # continue

    if channel:
        notify_peers_of_event(
            channel, connection_id, {"sys": "peer_left", "connectionId": connection_id}
        )

    return {"statusCode": 200, "body": "Disconnected"}


# ---------------------------
# 3. Handle Send Message
# ---------------------------
def on_send_message(event):
    request_ctx = event.get("requestContext", {})
    from_connection = request_ctx.get("connectionId")
    body_raw = event.get("body", "")
    try:
        body = json.loads(body_raw) if body_raw else {}
    except Exception:
        log("Invalid JSON body:", body_raw)
        return {"statusCode": 400, "body": "Invalid JSON"}

    action = body.get("action") or "sendMessage"  # allow flexible clients
    # Expect body to include "channel" and "type" (offer|answer|ice) and "payload"
    channel = body.get("channel")
    msg_type = body.get("type")

    ALLOWED_TYPES = {
        "offer",
        "answer",
        "ice",
        "ready",
        "file-meta",
        "file-chunk",
        "file-complete",
    }
    if msg_type not in ALLOWED_TYPES:
        return {"statusCode": 400, "body": "Invalid type"}

    payload = body.get("payload")
    
    if not isinstance(payload, (dict, list, str, int, float, bool, type(None))):
        return {"statusCode": 400, "body": "Invalid payload"}


    log(
        "on_message action:",
        action,
        "from:",
        from_connection,
        "channel:",
        channel,
        "type:",
        msg_type,
    )

    if action == "sendMessage":
        if not channel or not msg_type:
            return {"statusCode": 400, "body": "Missing channel or type"}

        # Query peers by channel using GSI
        peers = query_peers_by_channel(channel)
        if peers is None:
            return {"statusCode": 500, "body": "DB query error"}

        # prepare message to forward
        forward = {"type": msg_type, "from": from_connection, "payload": payload}

        forwarded_count = 0
        for peer in peers:
            pid = peer.get("connectionId")
            if pid == from_connection:
                continue
            try:
                apigw.post_to_connection(
                    ConnectionId=pid, Data=json.dumps(forward).encode("utf-8")
                )
                forwarded_count += 1
            except apigw.exceptions.GoneException:
                log("Found stale connection (Gone):", pid, " - deleting")
                try:
                    table.delete_item(Key={"connectionId": pid})
                except Exception as e:
                    log("Failed to delete stale connection:", pid, e)
            except Exception as e:
                log("Failed to post to connection:", pid, str(e))
        log(
            f"Forwarded message '{msg_type}' from {from_connection} to {forwarded_count} peers in channel {channel}"
        )
        return {"statusCode": 200, "body": f"Forwarded to {forwarded_count} peers"}

    # support custom actions if needed
    return {"statusCode": 400, "body": "Unknown action"}


# ---------------------------
# Helpers
# ---------------------------
def query_peers_by_channel(channel):
    """
    Query DynamoDB GSI by channel. Handles pagination.
    Returns list of items or None on error.
    """
    try:
        items = []
        kwargs = {
            "IndexName": CHANNEL_INDEX,
            "KeyConditionExpression": Key("channel").eq(channel),
            "ProjectionExpression": "connectionId,#ch",
            "ExpressionAttributeNames": {"#ch": "channel"},
        }
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        while resp.get("LastEvaluatedKey"):
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
            resp = table.query(**kwargs)
            items.extend(resp.get("Items", []))
        log("query_peers_by_channel:", channel, "found", len(items))
        return items
    except Exception as e:
        log("Error querying peers by channel:", e)
        traceback.print_exc()
        return None


def notify_peers_of_event(channel, origin_connection_id, event_payload):
    """
    Send a system event to all peers in the channel except origin_connection_id.
    event_payload is a dict that will be sent as JSON.
    """

    peers = query_peers_by_channel(channel)
    if not peers:
        return
    msg = {
        "type": event_payload["sys"],   # peer_joined | peer_left
        "payload": {
            "connectionId": event_payload["connectionId"]
    }
}

    for peer in peers:
        pid = peer.get("connectionId")
        if pid == origin_connection_id:
            continue
        try:
            apigw.post_to_connection(
                ConnectionId=pid, Data=json.dumps(msg).encode("utf-8")
            )
        except apigw.exceptions.GoneException:
            log("Stale connection during notify:", pid, "deleting")
            try:
                table.delete_item(Key={"connectionId": pid})
            except Exception as e:
                log("Failed deleting stale connection after notify:", pid, e)
        except Exception as e:
            log("Failed to send notify to", pid, e)

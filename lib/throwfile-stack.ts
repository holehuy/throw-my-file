import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

export class ThrowfileStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'ThrowfileQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    const domainName = process.env.FRONTEND_DOMAIN;
    const certArn = process.env.ACM_CERT_ARN;

    // 1. DynamoDB save mapping connectionId -> channelId
    const table = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "expiresAt",
    });

    // add GSI: query by channel
    table.addGlobalSecondaryIndex({
      indexName: "ByChannelIndex",
      partitionKey: {
        name: "channel",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // 2. Lambda handler for WebSocket events
    const handler = new lambda.Function(this, "SignalingHandler", {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "app.handler",
      code: lambda.Code.fromAsset("lambda"),
      environment: {
        TABLE_NAME: table.tableName,
        CHANNEL_INDEX_NAME: "ByChannelIndex",
      },
    });
    table.grantReadWriteData(handler);

    // 3. WebSocket API
    const wsApi = new apigwv2.WebSocketApi(this, "SignalingWSAPI", {
      apiName: "signaling-api",
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          "ConnectIntegration",
          handler
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          "DisconnectIntegration",
          handler
        ),
      },
      defaultRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          "DefaultIntegration",
          handler
        ),
      },
    });

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/*/*/@connections/*`,
        ],
      })
    );

    // 4. Stage
    const stage = new apigwv2.WebSocketStage(this, "ProdStage", {
      webSocketApi: wsApi,
      stageName: "prod",
      autoDeploy: true,
    });

    // 5. Add Environment To Lambda
    handler.addEnvironment("WS_ENDPOINT", stage.url);
    const managementApiUrl = `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${stage.stageName}`;
    handler.addEnvironment("MANAGEMENT_API_URL", managementApiUrl);

    // 6. S3 private bucket for react
    const frontendBucket = new s3.Bucket(this, "OriginBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // 7. CloudFront Distribution
    const distribution = new cloudfront.Distribution(
      this,
      "Distribution",
      {
        domainNames: domainName ? [domainName] : undefined,
        certificate: certArn
          ? acm.Certificate.fromCertificateArn(this, "FrontendCert", certArn)
          : undefined,
        defaultBehavior: {
          origin:
            origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(0),
          },
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(0),
          },
        ],
      }
    );

    new cdk.CfnOutput(this, "WebSocketWSSURL", {
      value: stage.url,
    });
    new cdk.CfnOutput(this, "WebSocketHTTPSURL", {
      value: managementApiUrl,
    });
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
    });
    new cdk.CfnOutput(this, "AlternativeDomainName", {
      value: domainName ?? "",
    });
  }
}

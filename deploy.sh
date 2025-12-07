#!/bin/bash

# Usage:
# ./deploy.sh --profile your-profile-name

# ===== PARSE ARGUMENTS =====
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --profile) AWS_PROFILE="$2"; shift ;;
    *) echo "Unknown parameter passed: $1"; exit 1 ;;
  esac
  shift
done

if [ -z "$AWS_PROFILE" ]; then
  echo "❌ Missing --profile parameter"
  echo "Example: ./deploy.sh --profile dev"
  exit 1
fi

STACK_NAME="ThrowfileStack"
BUILD_DIR="dist"
FRONTEND_DIR="frontend"
ENV_FILE="$FRONTEND_DIR/.env.production"

echo "🔍 Using AWS profile: $AWS_PROFILE"

# ===== GET BUCKET FROM CDK OUTPUT =====
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --profile "$AWS_PROFILE" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

# ===== GET WS URL FROM CDK OUTPUT =====
WS_URL=$(aws cloudformation describe-stacks \
  --profile "$AWS_PROFILE" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebSocketWSSURL'].OutputValue" \
  --output text)

if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
  echo "❌ FrontendBucketName not found in stack outputs"
  exit 1
fi

if [ -z "$WS_URL" ] || [ "$WS_URL" = "None" ]; then
  echo "❌ WebSocketWSS_URL not found in stack outputs"
  exit 1
fi

# Convert https:// -> wss://
WS_URL=${WS_URL/https:\/\//wss://}

echo "✅ Bucket name: $BUCKET_NAME"
echo "✅ WebSocket URL: $WS_URL"

# ===== WRITE ENV FILE =====
echo "VITE_WS_URL=$WS_URL" > "$ENV_FILE"
echo "✅ Wrote $ENV_FILE"

# ===== BUILD FRONTEND =====
echo "🔨 Building frontend..."
cd "$FRONTEND_DIR" || exit 1
npm install
npm run build

# ===== DEPLOY TO S3 =====
echo "🚀 Syncing to S3..."
aws s3 sync "$BUILD_DIR" "s3://$BUCKET_NAME" \
  --profile "$AWS_PROFILE" \
  --delete \
  --cache-control "no-store, max-age=0"

echo "✅ Deployment completed successfully!"

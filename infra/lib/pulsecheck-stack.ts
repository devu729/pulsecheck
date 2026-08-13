import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ses from "aws-cdk-lib/aws-ses";
import type { Construct } from "constructs";
import * as path from "node:path";

export class PulseCheckStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    /* ---------------------------- networking ---------------------------- */
    // Single NAT gateway (not one per AZ) — the standard cost trade-off for
    // a portfolio-scale deployment; call this out explicitly if it comes up
    // in an interview, it shows you understand the cost/availability trade.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    /* ------------------------------ database ------------------------------ */
    const dbCredentials = rds.Credentials.fromGeneratedSecret("pulsecheck");

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: dbCredentials,
      databaseName: "pulsecheck",
      allocatedStorage: 20,
      backupRetention: Duration.days(0), // Free Tier RDS doesn't allow automated backups
      removalPolicy: RemovalPolicy.DESTROY, // portfolio project — not production data
      deletionProtection: false,
    });

    /* -------------------------- check pipeline -------------------------- */
    const dlq = new sqs.Queue(this, "CheckDLQ", { retentionPeriod: Duration.days(14) });
    const checkQueue = new sqs.Queue(this, "CheckQueue", {
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // No password here — Lambdas fetch it from Secrets Manager at cold start
    // (apps/worker/src/db.ts) using IAM permissions granted below. Nothing
    // secret ever appears in the CFN template or Lambda console.
    const lambdaEnv = {
      DB_SECRET_ARN: database.secret!.secretArn,
      DB_HOST: database.dbInstanceEndpointAddress,
      DB_NAME: "pulsecheck",
      CHECK_QUEUE_URL: checkQueue.queueUrl,
      ALERT_FROM_EMAIL: "alerts@pulsecheck.dev",
    };

    const workerCode = lambda.Code.fromAsset(path.join(__dirname, "../../apps/worker/dist"));

    const dispatcherFn = new lambda.Function(this, "DispatcherFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "dispatcher.handler",
      code: workerCode,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: lambdaEnv,
      timeout: Duration.seconds(30),
    });

    const checkerFn = new lambda.Function(this, "CheckerFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "checker.handler",
      code: workerCode,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: { ...lambdaEnv, ALERT_TO_EMAIL: process.env.ALERT_TO_EMAIL ?? "" }, // pass at deploy: ALERT_TO_EMAIL=you@example.com cdk deploy
      timeout: Duration.seconds(20),
      // No reservedConcurrentExecutions: small/free-tier accounts often have
      // too low a total concurrency limit to reserve any meaningfully — SQS's
      // own batch size already caps how many run at once in practice.
    });

    database.secret!.grantRead(dispatcherFn);
    database.secret!.grantRead(checkerFn);
    checkQueue.grantConsumeMessages(checkerFn);
    checkQueue.grantSendMessages(dispatcherFn);
    checkerFn.addEventSource(new lambdaEventSources.SqsEventSource(checkQueue, {
      batchSize: 10,
      reportBatchItemFailures: true,
    }));
    database.connections.allowDefaultPortFrom(dispatcherFn);
    database.connections.allowDefaultPortFrom(checkerFn);

    // Runs every minute. rate(1 minute) is the finest granularity EventBridge
    // schedules support; it's what determines the platform's minimum monitor
    // interval.
    new events.Rule(this, "DispatchSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(dispatcherFn)],
    });

    /* --------------------------------- api --------------------------------- */
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const apiService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "ApiService", {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../../apps/api"), {
          platform: ecrAssets.Platform.LINUX_AMD64,
        }),
        containerPort: 4000,
        environment: {
          DB_HOST: database.dbInstanceEndpointAddress,
          DB_NAME: "pulsecheck",
          PORT: "4000",
        },
        // ECS resolves these directly from Secrets Manager at task start —
        // same reasoning as the Lambda secret fetch above, different
        // mechanism (this is the standard, native way to do it for ECS).
        secrets: {
          DB_USER: ecs.Secret.fromSecretsManager(database.secret!, "username"),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, "password"),
        },
      },
      publicLoadBalancer: true,
    });
    database.connections.allowDefaultPortFrom(apiService.service);
    apiService.targetGroup.configureHealthCheck({ path: "/health" });

    /* ------------------------------ frontend ------------------------------ */
    const siteBucket = new s3.Bucket(this, "WebBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const distribution = new cloudfront.Distribution(this, "WebDistribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" }, // client-side routing
      ],
    });

    // Deploys apps/web/dist to S3 and invalidates CloudFront on every
    // `cdk deploy`. Run `npm run build -w apps/web` first — see README.
    new s3deploy.BucketDeployment(this, "WebDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../apps/web/dist"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    /* -------------------------------- alerts -------------------------------- */
    // Sandbox SES identity — verify a real "from" address post-deploy to send
    // beyond the SES sandbox's verified-recipients-only restriction.
    new ses.EmailIdentity(this, "AlertSenderIdentity", {
      identity: ses.Identity.email("alerts@pulsecheck.dev"),
    });

    /* -------------------------------- outputs -------------------------------- */
    new CfnOutput(this, "ApiUrl", { value: `http://${apiService.loadBalancer.loadBalancerDnsName}` });
    new CfnOutput(this, "WebUrl", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "DatabaseSecretArn", { value: database.secret!.secretArn });
  }
}
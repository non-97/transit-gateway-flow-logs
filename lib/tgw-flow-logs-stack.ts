import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class TgwFlowLogsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SSM IAM Role
    const ssmIamRole = new cdk.aws_iam.Role(this, "SSM IAM Role", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    // VPC
    const vpcA = new cdk.aws_ec2.Vpc(this, "VPC A", {
      cidr: "10.0.1.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          cidrMask: 27,
        },
        {
          name: "Isolated",
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    const vpcB = new cdk.aws_ec2.Vpc(this, "VPC B", {
      cidr: "10.0.2.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          cidrMask: 27,
        },
        {
          name: "Isolated",
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    // Security Group
    const vpcASecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "Security Group of VPC A",
      {
        vpc: vpcA,
      }
    );
    vpcASecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.ipv4(vpcB.vpcCidrBlock),
      cdk.aws_ec2.Port.allTraffic()
    );

    const vpcBSecurityGroup = new cdk.aws_ec2.SecurityGroup(
      this,
      "Security Group of VPC B",
      {
        vpc: vpcB,
      }
    );
    vpcBSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.ipv4(vpcA.vpcCidrBlock),
      cdk.aws_ec2.Port.allTraffic()
    );

    // Transit Gateway
    const tgw = new cdk.aws_ec2.CfnTransitGateway(this, "Transit Gateway", {
      amazonSideAsn: 65000,
      autoAcceptSharedAttachments: "enable",
      defaultRouteTableAssociation: "enable",
      defaultRouteTablePropagation: "enable",
      dnsSupport: "enable",
      multicastSupport: "enable",
      tags: [
        {
          key: "Name",
          value: "tgw",
        },
      ],
      vpnEcmpSupport: "enable",
    });

    // Transit Gateway attachment
    const tgwVpcAAttachment = new cdk.aws_ec2.CfnTransitGatewayVpcAttachment(
      this,
      "Transit Gateway attachment VPC A",
      {
        subnetIds: vpcA.selectSubnets({
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        transitGatewayId: tgw.ref,
        vpcId: vpcA.vpcId,
        options: {
          DnsSupport: "enable",
        },
        tags: [
          {
            key: "Name",
            value: "tgw-attach-vpc-a",
          },
        ],
      }
    );

    const tgwVpcBAttachment = new cdk.aws_ec2.CfnTransitGatewayVpcAttachment(
      this,
      "Transit Gateway attachment VPC B",
      {
        subnetIds: vpcB.selectSubnets({
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        transitGatewayId: tgw.ref,
        vpcId: vpcB.vpcId,
        options: {
          DnsSupport: "enable",
        },
        tags: [
          {
            key: "Name",
            value: "tgw-attach-vpc-b",
          },
        ],
      }
    );

    // Route to Transit Gateway
    vpcA
      .selectSubnets({ subnetType: cdk.aws_ec2.SubnetType.PUBLIC })
      .subnets.forEach((subnet, index) => {
        const routeTableName = `vpc-a-rtb-public-${index}`;

        new cdk.aws_ec2.CfnRoute(
          this,
          `${routeTableName} route to Transit Gateway`,
          {
            routeTableId: subnet.routeTable.routeTableId,
            destinationCidrBlock: vpcB.vpcCidrBlock,
            transitGatewayId: tgw.ref,
          }
        ).addDependsOn(tgwVpcAAttachment);
      });

    vpcB
      .selectSubnets({ subnetType: cdk.aws_ec2.SubnetType.PUBLIC })
      .subnets.forEach((subnet, index) => {
        const routeTableName = `vpc-b-rtb-public-${index}`;

        new cdk.aws_ec2.CfnRoute(
          this,
          `${routeTableName} route to Transit Gateway`,
          {
            routeTableId: subnet.routeTable.routeTableId,
            destinationCidrBlock: vpcA.vpcCidrBlock,
            transitGatewayId: tgw.ref,
          }
        ).addDependsOn(tgwVpcAAttachment);
      });

    // EC2 Instance
    new cdk.aws_ec2.Instance(this, "EC2 Instance A", {
      instanceType: new cdk.aws_ec2.InstanceType("t3.micro"),
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux({
        generation: cdk.aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcA,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: cdk.aws_ec2.BlockDeviceVolume.ebs(8, {
            volumeType: cdk.aws_ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcA.selectSubnets({
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
      securityGroup: vpcASecurityGroup,
    });

    new cdk.aws_ec2.Instance(this, "EC2 Instance B", {
      instanceType: new cdk.aws_ec2.InstanceType("t3.micro"),
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux({
        generation: cdk.aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcB,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: cdk.aws_ec2.BlockDeviceVolume.ebs(8, {
            volumeType: cdk.aws_ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcB.selectSubnets({
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
      securityGroup: vpcBSecurityGroup,
    });

    // Transit Gateway Flow Logs S3 Bucket
    const tgwFlowLogsBucket = new cdk.aws_s3.Bucket(
      this,
      "Transit Gateway Flow Logs Bucket",
      {
        bucketName: "bucket-tgw-flow-logs",
        encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: new cdk.aws_s3.BlockPublicAccess({
          blockPublicAcls: true,
          blockPublicPolicy: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: true,
        }),
        enforceSSL: true,
      }
    );

    new cdk.aws_ec2.CfnFlowLog(this, "Transit Gateway Flow Logs", {
      resourceId: tgw.ref,
      resourceType: "TransitGateway",
      logDestination: tgwFlowLogsBucket.bucketArn,
      logDestinationType: "s3",
      logFormat:
        "${version} ${resource-type} ${account-id} ${tgw-id} ${tgw-attachment-id} ${tgw-src-vpc-account-id} ${tgw-dst-vpc-account-id} ${tgw-src-vpc-id} ${tgw-dst-vpc-id} ${tgw-src-subnet-id} ${tgw-dst-subnet-id} ${tgw-src-eni} ${tgw-dst-eni} ${tgw-src-az-id} ${tgw-dst-az-id} ${tgw-pair-attachment-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${log-status} ${type} ${packets-lost-no-route} ${packets-lost-blackhole} ${packets-lost-mtu-exceeded} ${packets-lost-ttl-expired} ${tcp-flags} ${region} ${flow-direction} ${pkt-src-aws-service} ${pkt-dst-aws-service}",
      maxAggregationInterval: 60,
      destinationOptions: {
        FileFormat: "plain-text",
        HiveCompatiblePartitions: false,
        PerHourPartition: true,
      },
      tags: [
        {
          key: "Name",
          value: "tgw-flow-logs",
        },
      ],
    });
  }
}

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TgwFlowLogsStack } from '../lib/tgw-flow-logs-stack';

const app = new cdk.App();
new TgwFlowLogsStack(app, 'TgwFlowLogsStack',);
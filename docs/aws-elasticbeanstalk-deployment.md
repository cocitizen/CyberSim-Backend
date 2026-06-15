# AWS Elastic Beanstalk Deployment Guide

This document describes how to deploy the CyberSim Backend API to AWS
using Elastic Beanstalk, Docker, an Application Load Balancer (ALB) with
ACM TLS, and PostgreSQL on Amazon RDS.

The backend runs inside a Docker container defined by the `Dockerfile`
in the repository root.

## Quick Deployment Summary

A typical production deployment follows these steps:

1.  Create shared infrastructure (security groups, RDS database, ACM
    certificate for `api.cybersim.app`).
2.  Create a new Elastic Beanstalk environment using:
   - **Docker**
   - **Amazon Linux 2023**
   - **Web server**
   - **Load balanced**
3.  Attach reusable security groups to the load balancer and instances.
   - Amazon Load Balancer (ALB): `cybersim-alb-public-sg`
   - app instances: `cybersim-backend-app-sg`
4. Configure environment variables in Elastic Beanstalk:
   - `DB_URL`
   - `UI_ORIGINS`
   - `PORT`
   - `NODE_ENV`
5.  Deploy the backend application bundle.
6. Configure the load balancer:
   - HTTP :80 redirects to HTTPS :443
   - HTTPS :443 uses the ACM certificate for `api.cybersim.app`
   - HTTPS listener action is **Forward to target group**
   - target group health check path is `/health`
7. Verify the new environment directly using:
   - `https://<eb-hostname>/health`
   - `https://<eb-hostname>/health/db`
8.  Point `api.cybersim.app` to the EB environment using Cloudflare DNS.
9.  Run database migrations and seed initial data.

Once configured, future deployments only require uploading a new application bundle.

If an EB environment becomes unstable or gets stuck in update / replacement loops, it is often faster to create a fresh environment and repoint DNS than to repair the broken one in place.



## Overview

Production deployment consists of the following components:

-   Cloudflare DNS
-   AWS Application Load Balancer (ALB) with ACM TLS
-   Elastic Beanstalk (Docker platform)
-   PostgreSQL (Amazon RDS)
-   Environment variables configured in Elastic Beanstalk

Architecture:

    Internet
       │
    Cloudflare DNS
       │
    api.cybersim.app
       │
    HTTPS (443)
       │
    AWS Application Load Balancer
       │
    Elastic Beanstalk EC2 Instance
       │
    Docker container
       │
    Node / Express API
       │
    PostgreSQL (RDS)

Infrastructure components such as security groups and TLS certificates
should be created once and reused across environments.

### Security Group Relationship Diagram

    Internet
       │
       ▼
    cybersim-alb-public-sg
      inbound: 80, 443 from 0.0.0.0/0
       │
       ▼
    cybersim-backend-app-sg
      inbound: 8080 from cybersim-alb-public-sg
       │
       ▼
    cybersim-rds-production-sg
      inbound: 5432 from cybersim-backend-app-sg

This arrangement allows:

-   public web traffic to reach the load balancer
-   only the load balancer to reach backend instances
-   only backend instances to reach PostgreSQL

## Common Failure Points

The most common production deployment failures are infrastructure configuration issues rather than application code issues.

### Cloudflare / TLS / ALB failures

If Cloudflare is set to **Full (strict)**, the origin must present a valid TLS certificate. In this deployment that means:

- the ALB must have an HTTPS listener on **443**
- the HTTPS listener must use the ACM certificate for `api.cybersim.app`
- the certificate must be attached to the ALB's 443 listener; creating the certificate in ACM alone is not sufficient.
- the ALB security group must allow inbound **443** from `0.0.0.0/0`

A missing 443 inbound rule on the ALB security group will make the API appear down even if the backend container is healthy.

### Target group / health check failures

If the target group is unhealthy, check:

- app listens on **0.0.0.0:8080**
- Dockerfile includes `EXPOSE 8080`
- instance security group allows **8080** from `cybersim-alb-public-sg`
- health check path is `/health`
- `/health` returns:

```json
{"status":"ok"}
```


### Environment churn / replacement loop

If Elastic Beanstalk repeatedly launches and replaces instances:
- check the target group health reason first
- then check EB Events
- then check CloudFormation Events
- then check Auto Scaling activity

If the environment appears wedged, creating a fresh EB environment is often the fastest recovery path.


## Infrastructure Setup (One-Time Setup)

### Security Groups

Create three reusable security groups.

#### ALB Security Group

Example:

    cybersim-alb-public-sg

Inbound rules:

    80   from 0.0.0.0/0
    443  from 0.0.0.0/0

Outbound:

    Allow all

#### Backend Application Security Group

Example:

    cybersim-backend-app-sg

Inbound rules:

    8080 from cybersim-alb-public-sg

Outbound:

    Allow all

#### Database Security Group

Example:

    cybersim-rds-production-sg

Inbound rules:

    5432 from cybersim-backend-app-sg

### Create the PostgreSQL Database

Create an Amazon RDS PostgreSQL instance.

Recommended baseline configuration:

-   Engine: PostgreSQL
-   Version: 15.x
-   Instance class: small / free-tier compatible
-   Storage: 20GB
-   Availability: Single AZ
-   Public access: Disabled
-   VPC: Same VPC used for Elastic Beanstalk
-   Security group: `cybersim-rds-production-sg`

Create the database:

    cybersim

Record the connection string:

    postgres://<USER>:<PASSWORD>@<RDS-ENDPOINT>:5432/cybersim

### Create TLS Certificate (ACM)

Request a certificate in AWS Certificate Manager for:

    api.cybersim.app

Use DNS validation and wait for status:

    Issued

## Elastic Beanstalk Setup


### Create Environment

Configuration:

- Environment tier: **Web server**
- Platform: **Docker (Amazon Linux 2023)**
- Environment type: **Load balanced**
- Instance type: **t3.micro**
- Minimum instances: **1**
- Maximum instances: **1**

Attach instance role:

    aws-elasticbeanstalk-ec2-role

Ensure the role includes:

    AmazonSSMManagedInstanceCore

Recommended settings during initial recovery / stabilization:

- Managed platform updates: **Off**
- Keep logs on terminate: **On**
- Health reporting: **Enhanced**

Networking guidance:

- ALB should be **internet-facing**
- ALB should be attached to **public subnets**
- app instances may be attached to **private subnets**
- instances do not need public IPs if the VPC/networking is set up correctly

If rebuilding after a broken deployment, prefer creating a **new environment** over cloning a visibly unhealthy one unless you are confident the existing environment settings are clean.


### Attach Security Groups

Load balancer security group:

    cybersim-alb-public-sg

Instance security group:

    cybersim-backend-app-sg

Expected rule pattern:

- `cybersim-alb-public-sg`
  - inbound `80` from `0.0.0.0/0`
  - inbound `443` from `0.0.0.0/0`

- `cybersim-backend-app-sg`
  - inbound `8080` from `cybersim-alb-public-sg`

- `cybersim-rds-production-sg`
  - inbound `5432` from `cybersim-backend-app-sg`

This is the minimum security-group chain needed for:

- public HTTPS traffic to reach the ALB
- the ALB to reach the backend app on port 8080
- the backend app to reach PostgreSQL

## Application Configuration

### Required Environment Variables

Set these in:

Elastic Beanstalk → Configuration → Software → Environment properties

    PORT=8080
    NODE_ENV=production
    DB_URL=postgres://<USER>:<PASSWORD>@<HOST>:<PORT>/<DB_NAME>
    UI_ORIGINS=https://cso.cybersim.app,https://tnr.cybersim.app
    AIRTABLE_ACCESS_TOKEN=patXXXXXXXXXXXXXX
    AIRTABLE_BASE_IDS=cso:appXXXXXX,tnr:appYYYYYY

### Optional Environment Variables

    IMPORT_PASSWORD=<chosen-password>
    SCENARIO_SLUG=cso
    LOG_LEVEL=error

`IMPORT_PASSWORD` enables the scenario import feature in the UI. Without it, all import requests are rejected.

`AIRTABLE_BASE_IDS` maps each scenario slug to its Airtable base ID. The slug must match the subdomain (e.g. `cso` for `cso.cybersim.app`). One `AIRTABLE_ACCESS_TOKEN` can cover all bases.

### CORS Configuration

`UI_ORIGINS` is a comma-separated list of allowed frontend origins with no trailing slashes.

The backend uses an exact-match allowlist. Add every frontend origin that should be allowed to call the API, including each production subdomain.

Example:

    UI_ORIGINS=https://cso.cybersim.app,https://tnr.cybersim.app

Do not rely on `*` in production if browser credentials or authenticated requests are involved. Use the explicit allowlist from `UI_ORIGINS`.

### Docker Port Configuration

The app must listen on port 8080.

Example:

``` javascript
const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0');
```

Dockerfile must include:

``` dockerfile
EXPOSE 8080
```

## Load Balancer Configuration

### Listener Model

The ALB should have two listeners:

- **HTTP :80**
- **HTTPS :443**

Recommended behavior:

- **HTTP :80** → redirect to **HTTPS :443**
- **HTTPS :443** → forward to the backend target group

A target group is the backend pool the ALB sends requests to. In this deployment, the target group contains the Elastic Beanstalk EC2 instance(s) serving the Dockerized backend on port 8080.

### HTTPS Listener

Port:

    443

Certificate:

    ACM certificate for api.cybersim.app

Recommended policy:

    ELBSecurityPolicy-TLS13-1-2-2021-06

Routing action:

    Forward to target group

### HTTP Redirect

    HTTP :80 → HTTPS :443

### Health Checks

Target group health check path:

    /health

Expected response:

    {"status":"ok"}

If the target group is unhealthy, check:

- app port is `8080`
- app is listening on `0.0.0.0`
- instance security group allows `8080` from the ALB security group
- the app is returning HTTP 200 on `/health`

## Post-Create Checklist

After the new environment is created, verify the following before changing Cloudflare DNS.

### Elastic Beanstalk / ALB checks

- platform is **Docker on Amazon Linux 2023**
- environment is **Load balanced**
- ALB is **internet-facing**
- ALB has a listener on **443**
- 443 listener uses the ACM cert for `api.cybersim.app`
- 443 listener action is **Forward to target group**
- ALB security group allows inbound **443**
- target group health check path is `/health`

### Backend checks

- environment variables are set
- app listens on **8080**
- target group shows the instance as **healthy**

### Direct validation checks

Verify the EB hostname directly first:

    https://<eb-hostname>/health
    https://<eb-hostname>/health/db

Then verify the public hostname:

    https://api.cybersim.app/health
    https://api.cybersim.app/health/db


## Operational Access and Database Migrations

The backend applies pending Knex migrations automatically during application
startup. The Docker container starts with `npm run start:prod`, which runs
`index.js`; non-test startup calls `db.migrate.latest()` before the server begins
listening. A normal Elastic Beanstalk deployment should therefore apply new
migrations when the replacement container starts.

The manual steps below are still useful for verification, troubleshooting, or
recovery after a failed deployment. `npm run migrate` is safe to rerun when no
pending migrations exist.

### Find the EC2 instance for an EB environment

```bash
aws elasticbeanstalk describe-environment-resources \
  --environment-name <eb-environment-name> \
  --query 'EnvironmentResources.Instances[*].Id' \
  --output text
```

### Connect with Session Manager

```bash
aws ssm start-session --target <instance-id>
```

If Docker access requires root privileges, switch to root after connecting:

```bash
sudo bash
```

### Enter the backend container

Identify the running backend container:

```bash
docker ps
```

Enter the container:

```bash
docker exec -it <container-id> sh
```

### Check and run migrations

Check migration status:

```bash
./node_modules/.bin/knex migrate:status
```

If migrations are pending, run:

```bash
npm run migrate
```

Check status again:

```bash
./node_modules/.bin/knex migrate:status
```

### Validate after migration

Verify application and database health:

```bash
curl -i https://api.cybersim.app/health
curl -i https://api.cybersim.app/health/db
```

If Airtable-backed scenario import is expected, also verify:

```bash
curl -i https://api.cybersim.app/health/airtable
```

For a scenario-specific check:

```bash
curl -i 'https://api.cybersim.app/scenario?scenarioSlug=<slug>'
curl -i 'https://api.cybersim.app/injections?scenarioSlug=<slug>'
```

Do not run seed commands in production unless intentionally bootstrapping,
resetting, or loading scenario data. For scenario setup, use
`docs/scenario-setup.md`.

## Logging and Troubleshooting

Recommended settings:

- Keep logs on terminate: **On**
- S3 log storage: **On**
- CloudWatch log streaming: optional but useful

When diagnosing deployment problems, check in this order:

1. target group health and health reason
2. Elastic Beanstalk Events
3. CloudFormation Events
4. Auto Scaling activity
5. application/container logs


## Deployment Validation

Verify application health:

    https://api.cybersim.app/health
    https://api.cybersim.app/health/db

If Airtable-backed scenario import is expected, also verify:

    https://api.cybersim.app/health/airtable

Interpretation:

- `/health` confirms the application is up
- `/health/db` confirms database connectivity
- `/health/airtable` confirms Airtable-related configuration is present

## DNS Configuration

Cloudflare DNS:

    api.cybersim.app → CNAME → <environment><aws-string>.us-east-1.elasticbeanstalk.com

Important:

- use the EB environment hostname as the CNAME target
- do **not** include `http://` or `https://` in the CNAME target

Cloudflare SSL mode:

    Full (strict)

For Full (strict) to work, the ALB must present a valid certificate for `api.cybersim.app` on the HTTPS listener.

## Recovering from a Broken Environment

If an Elastic Beanstalk environment becomes unstable, stuck in updates, or trapped in unhealthy instance replacement loops, the fastest recovery path is often:

1. create a fresh EB environment
2. reuse the shared infrastructure:
   - security groups
   - RDS database
   - ACM certificate
3. deploy the same backend application bundle
4. verify:
   - `/health`
   - `/health/db`
5. update the Cloudflare CNAME to the new EB hostname
6. only delete the old environment after the new one is healthy

This is often faster and safer than trying to repair a badly wedged EB environment in place.


## Result

A working deployment consists of:

-   Cloudflare DNS
-   AWS Application Load Balancer with ACM TLS
-   Elastic Beanstalk environment
-   Docker backend container
-   PostgreSQL RDS database

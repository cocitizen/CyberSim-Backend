# CyberSim Terraform

This Terraform configuration creates a parallel Elastic Beanstalk backend environment for CyberSim.

It currently creates:

- a new Elastic Beanstalk application and environment
- a new load balancer security group
- a new backend instance security group
- an ingress rule allowing the new backend security group to reach the existing RDS security group

It reuses:

- the existing VPC and subnets
- the existing RDS database
- the existing ACM certificate for `api.cybersim.app`

It does not manage:

- Cloudflare DNS
- RDS creation
- Amplify
- Airtable
- application deployment bundles

Do not commit `terraform.tfvars`, state files, or secrets.

## Basic workflow

```bash
terraform fmt
terraform init
terraform validate
terraform plan
terraform apply

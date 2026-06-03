resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Allow public HTTP and HTTPS traffic to the CyberSim backend load balancer."
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alb-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "alb_http_from_internet" {
  security_group_id = aws_security_group.alb.id

  description = "Allow public HTTP traffic to the load balancer."
  ip_protocol = "tcp"
  from_port   = 80
  to_port     = 80
  cidr_ipv4   = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https_from_internet" {
  security_group_id = aws_security_group.alb.id

  description = "Allow public HTTPS traffic to the load balancer."
  ip_protocol = "tcp"
  from_port   = 443
  to_port     = 443
  cidr_ipv4   = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_http_to_backend" {
  security_group_id = aws_security_group.alb.id

  description                  = "Allow the load balancer to reach backend instances over HTTP."
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = aws_security_group.backend_instance.id
}

resource "aws_security_group" "backend_instance" {
  name        = "${local.name_prefix}-backend-instance-sg"
  description = "Allow backend instance traffic only from the CyberSim backend load balancer."
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-backend-instance-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "backend_http_from_alb" {
  security_group_id = aws_security_group.backend_instance.id

  description                  = "Allow HTTP traffic from the load balancer to EB instances."
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "backend_all_outbound" {
  security_group_id = aws_security_group.backend_instance.id

  description = "Allow backend instances to reach the internet, RDS, and external APIs."
  ip_protocol = "-1"
  cidr_ipv4   = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "rds_postgres_from_backend" {
  security_group_id = var.rds_security_group_id

  description                  = "Allow Terraform-managed CyberSim backend instances to reach PostgreSQL."
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.backend_instance.id
}
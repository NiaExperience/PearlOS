locals {
  canary_script = <<EOF
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const apiCanaryBlueprint = async function () {
    const targets = process.env.TARGETS ? process.env.TARGETS.split(',') : [];
    
    if (targets.length === 0) {
        log.error("No targets configured in TARGETS environment variable.");
        throw "No targets configured.";
    }

    let page = await synthetics.getPage();

    for (const url of targets) {
        // Sanitize step name: allowed [a-zA-Z0-9_ -.]
        let stepName = 'Check ' + url.replace(/[^a-zA-Z0-9_ -.]/g, '_');
        
        await synthetics.executeStep(stepName, async function () {
            log.info('Checking URL: ' + url);
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            if (!response) {
                 throw "No response received from " + url;
            }
            const status = response.status();
            log.info('Response Status: ' + status);
            if (status < 200 || status > 299) {
                throw 'Failed: ' + url + ' returned ' + status;
            }
            log.info('Success: ' + url + ' returned ' + status);
        });
    }
};

exports.handler = async () => {
    return await apiCanaryBlueprint();
};
EOF
  script_hash   = sha256(local.canary_script)
}

resource "aws_s3_bucket" "canary_artifacts" {
  bucket_prefix = "canary-${var.canary_name}-"
  force_destroy = true
  tags          = var.tags
}

resource "aws_iam_role" "canary_role" {
  name = "canary-role-${var.canary_name}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "canary_policy" {
  role       = aws_iam_role.canary_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "canary_s3_policy" {
  name = "canary-s3-policy"
  role = aws_iam_role.canary_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetBucketLocation",
          "s3:GetBucketAcl",
          "s3:ListAllMyBuckets"
        ]
        Resource = [
          "arn:aws:s3:::*",
          aws_s3_bucket.canary_artifacts.arn,
          "${aws_s3_bucket.canary_artifacts.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "canary_cw_policy" {
  name = "canary-cw-policy"
  role = aws_iam_role.canary_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" : "CloudWatchSynthetics"
          }
        }
      }
    ]
  })
}

data "archive_file" "canary_zip" {
  type        = "zip"
  output_path = "${path.module}/canary-${local.script_hash}.zip"

  source {
    content  = local.canary_script
    filename = "canary.js"
  }
}

resource "aws_synthetics_canary" "heartbeat" {
  name                 = var.canary_name
  artifact_s3_location = "s3://${aws_s3_bucket.canary_artifacts.bucket}/"
  execution_role_arn   = aws_iam_role.canary_role.arn
  handler              = "canary.handler"
  zip_file             = data.archive_file.canary_zip.output_path
  runtime_version      = var.runtime_version

  schedule {
    expression = var.schedule_expression
  }

  run_config {
    timeout_in_seconds = 60
    environment_variables = {
      TARGETS = join(",", var.targets)
    }
  }

  start_canary = true
  tags         = var.tags
}

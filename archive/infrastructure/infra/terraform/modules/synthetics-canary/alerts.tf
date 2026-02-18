resource "aws_cloudwatch_metric_alarm" "canary_failure" {
  alarm_name          = "${var.canary_name}-failure"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "SuccessPercent"
  namespace           = "CloudWatchSynthetics"
  period              = 300
  statistic           = "Average"
  threshold           = 100
  treat_missing_data  = "breaching"

  dimensions = {
    CanaryName = var.canary_name
  }

  alarm_description = "Synthetics canary ${var.canary_name} failure"
  alarm_actions     = []
  ok_actions        = []
  tags              = var.tags
}

output "canary_name" {
  value = aws_synthetics_canary.heartbeat.name
}

output "canary_arn" {
  value = aws_synthetics_canary.heartbeat.arn
}

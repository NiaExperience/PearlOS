variable "canary_name" {
  description = "Name of the canary"
  type        = string
}

variable "schedule_expression" {
  description = "Schedule expression (e.g., 'rate(5 minutes)')"
  type        = string
  default     = "rate(5 minutes)"
}

variable "targets" {
  description = "List of target URLs to check"
  type        = list(string)
}

variable "runtime_version" {
  description = "Runtime version for the canary"
  type        = string
  default     = "syn-nodejs-puppeteer-13.0"
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

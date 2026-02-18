{{/*
Common templating helpers for pipecat-daily-bot chart.
*/}}

{{- define "pipecat-daily-bot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pipecat-daily-bot.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "pipecat-daily-bot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pipecat-daily-bot.labels" -}}
helm.sh/chart: {{ include "pipecat-daily-bot.chart" . }}
{{ include "pipecat-daily-bot.selectorLabels" . }}
{{- if not .Values.labels.useLegacyAppLabel }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
{{- end -}}

{{- define "pipecat-daily-bot.selectorLabels" -}}
{{- if .Values.labels.useLegacyAppLabel }}
app: {{ default (include "pipecat-daily-bot.fullname" .) .Values.labels.legacyAppName }}
{{- else }}
app.kubernetes.io/name: {{ include "pipecat-daily-bot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
{{- end -}}

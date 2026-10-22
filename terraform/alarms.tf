# ── Missed-run alarm: no successful run in about an hour ──
#
# Successful runs = Invocations - Errors, in 15-minute buckets. Each bucket
# holds one scheduled run (:07/:22/:37/:52). Four breaching buckets in a row
# pages: roughly 45-60 min with no summary written. That catches a function
# that fails every time, a schedule that stopped invoking, and a function
# that was deleted, because no data is treated as breaching (the mesonet-aq
# and mesonet-power dead-man pattern). One or two failed runs do not page.
# A consumer sees the same thing: generated_at older than an hour.

resource "aws_cloudwatch_metric_alarm" "run_stale" {
  alarm_name        = "${var.project_name}-run-stale"
  alarm_description = "mesonet-compliance has not written ${local.summary_key} for about an hour. Read /aws/lambda/${var.project_name}; the usual cause is the mesonet2 API failing or timing out. The next good run repairs it."

  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 4
  datapoints_to_alarm = 4
  treat_missing_data  = "breaching"

  metric_query {
    id          = "ok"
    expression  = "FILL(inv, 0) - FILL(err, 0)"
    label       = "Successful runs"
    return_data = true
  }

  metric_query {
    id = "inv"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Invocations"
      stat        = "Sum"
      period      = 900
      dimensions  = { FunctionName = module.lambda.function_name }
    }
  }

  metric_query {
    id = "err"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Errors"
      stat        = "Sum"
      period      = 900
      dimensions  = { FunctionName = module.lambda.function_name }
    }
  }

  alarm_actions = [data.aws_sns_topic.ops_alerts.arn]
  ok_actions    = [data.aws_sns_topic.ops_alerts.arn]
}

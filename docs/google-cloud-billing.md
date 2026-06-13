# Google Cloud Billing Provider

Google Cloud Billing support is planned and is not implemented in v0.1.

The intended source is Cloud Billing export data in BigQuery, using standard, detailed, or FOCUS export tables.

## Cost-Bearing Calls

Unlike OpenAI and Anthropic admin usage endpoints, Google Cloud Billing export queries can be cost-bearing because they run BigQuery queries. Any release that adds this provider must include a release note that direct billing export queries can incur Google Cloud query costs.

## Planned Static Configuration

Expected future variables:

- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_BILLING_EXPORT_PROJECT_ID`
- `GOOGLE_BILLING_EXPORT_DATASET`
- `GOOGLE_BILLING_EXPORT_TABLE`
- `GOOGLE_BILLING_EXPORT_KIND`

The provider should expose `direct_queries_can_incur_cost: true` in its capabilities.

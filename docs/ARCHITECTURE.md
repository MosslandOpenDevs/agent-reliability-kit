# ARK Architecture (Draft)

ARK is organized as four composable modules:

1. sanitize
2. classify
3. policy
4. report

Data flow:
Runtime Event -> sanitize -> classify -> policy decision -> report

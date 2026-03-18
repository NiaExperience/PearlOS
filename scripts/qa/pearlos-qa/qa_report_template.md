# PearlOS QA Report

**Generated:** {{ generated_at }}

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | {{ total }} |
| ✅ Passed | {{ passed }} |
| ❌ Failed | {{ failed }} |

---

## Results

{% for result in results %}
### {% if result.passed %}✅{% else %}❌{% endif %} {{ result.test_name }}

- **File:** `{{ result.filename }}`
- **Timestamp:** {{ result.timestamp }}
- **Status:** {% if result.passed %}PASS{% else %}FAIL{% endif %}
{% if result.defects %}

**Defects found:**

{% for defect in result.defects %}
- {{ severity_icon[defect.severity] }} **{{ defect.severity | upper }}** — {{ defect.name }}: {{ defect.description }}
{% endfor %}
{% endif %}

---

{% endfor %}

## Legend

- 🔴 **CRITICAL** — Broken rendering, must fix before release
- 🟡 **WARNING** — Possible issue, needs manual review
- 🔵 **INFO** — Minor observation, may be expected

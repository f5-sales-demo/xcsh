# Walkthrough: End-to-End User Perspective Installation & Execution Verification

We have created and executed an automated End-to-End User Installation & Execution test script (**[`scripts/e2e-user-install-test.sh`](file:///data/robin-GIT/xcsh/scripts/e2e-user-install-test.sh)**) that simulates a real human user following our published guide in **[`docs/en/container/alpine-deployment.md`](file:///data/robin-GIT/xcsh/docs/en/container/alpine-deployment.md)**.

## Empirical Verification Summary

```text
=========================================================================
=== End-to-End User Perspective Installation & Verification PASSED! ===
=========================================================================
```

### Execution Steps Verified Live

1. **Container Build & Startup**:
   - Built Alpine container stack (`docker-compose.dev.yml`) using `no-new-privileges:true` and read-only host credential volume mounts.
2. **Non-Root User Security Verification**:
   - Confirmed container execution identity: `xcsh` (UID: `1000`, GID: `1000`).
3. **Multi-Cloud CLI Tool Suite Verification**:
   - Google Cloud SDK (`gcloud 579.0.0`)
   - Azure CLI (`az 2.89.0`)
   - AWS CLI (`aws 1.46.0`)
   - GitHub CLI (`gh 2.47.0`)
   - Bun (`1.3.14`)
4. **Master Container UAT Suite Execution (100% Pass Rate)**:
   - **Gemini Enterprise Auth**: Enterprise token & `gemini-3.1-pro-preview` endpoint verified (`ON_DEMAND` Vertex AI routing).
   - **Azure CLI Auth**: Account user `R.***@***.***` verified with masked email/subscription privacy.
   - **Synthesized Prompt Translation (5/5 Passed)**:
     - `tc-001-aws-cli`: Generated `aws s3 ls`
     - `tc-002-azure-cli`: Generated `az group create`
     - `tc-003-gcloud-cli`: Generated `gcloud compute instances list`
     - `tc-004-github-cli`: Generated `gh pr list`
     - `tc-005-marketplace-shell`: Generated `curl`
5. **Clean Resource Teardown**:
   - Container and network stack stopped and removed cleanly (`docker compose -f docker-compose.dev.yml down`).

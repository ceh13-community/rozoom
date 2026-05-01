export interface HumanizedVeleroError {
  title: string;
  hint: string | null;
}

/**
 * Map a raw Velero / cloud-provider stderr line to a titled error + fix hint.
 * Case-insensitive substring match; first match wins.
 */
export function humanizeVeleroError(raw: string): HumanizedVeleroError {
  const lower = raw.toLowerCase();

  // AWS / S3-compatible
  if (lower.includes("invalidaccesskeyid")) {
    return {
      title: "AWS access key not recognized",
      hint: "The key may have been rotated or deleted. Re-issue credentials and update the Velero secret.",
    };
  }
  if (lower.includes("signaturedoesnotmatch")) {
    return {
      title: "AWS signature mismatch",
      hint: "Secret key does not match the access key. Copy both values from IAM again.",
    };
  }
  if (lower.includes("nosuchbucket")) {
    return {
      title: "Bucket not found",
      hint: "Verify the bucket name and region (case-sensitive). Create it if it does not exist.",
    };
  }
  if (lower.includes("403 forbidden") || lower.includes("accessdenied")) {
    return {
      title: "Permission denied on bucket",
      hint: "The IAM user / role lacks s3:ListBucket or s3:PutObject on the target bucket.",
    };
  }
  if (lower.includes("expiredtoken") || lower.includes("tokenrefreshrequired")) {
    return {
      title: "Credentials expired",
      hint: "SSO/AssumeRole session has expired. Refresh and re-apply.",
    };
  }

  // Azure
  if (lower.includes("authenticationfailed") && lower.includes("azure")) {
    return {
      title: "Azure authentication failed",
      hint: "Service principal client id / secret / tenant id are incorrect or the secret expired.",
    };
  }
  if (lower.includes("containernotfound")) {
    return {
      title: "Azure container not found",
      hint: "Create the blob container, or fix the storage account name.",
    };
  }

  // GCP
  if (lower.includes("invalid_grant") || lower.includes("invalid jwt")) {
    return {
      title: "GCP service-account JSON rejected",
      hint: "The JSON key is malformed or the service account was revoked.",
    };
  }

  // Generic
  if (
    lower.includes("connection refused") ||
    lower.includes("no route to host") ||
    lower.includes("econnrefused")
  ) {
    return {
      title: "Object storage endpoint unreachable",
      hint: "Check the S3 URL, VPC / egress rules, and that the endpoint is reachable from this cluster.",
    };
  }
  if (lower.includes("validation failed") || lower.includes("validationerror")) {
    return {
      title: "Backup location validation failed",
      hint: "Velero tried to touch the bucket and got an error. See raw output for the underlying cause.",
    };
  }
  if (lower.includes("timeout")) {
    return {
      title: "Operation timed out",
      hint: "Velero pod did not complete in time. Check its logs and object-storage latency.",
    };
  }
  if (lower.includes("backupstoragelocation")) {
    return {
      title: "BackupStorageLocation misconfigured",
      hint: "The BSL CR is pointing at the wrong bucket/region or lacks credentials. Recreate via the form above.",
    };
  }

  return { title: "Backup action failed", hint: null };
}

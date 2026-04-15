# Deployment — AWS (api-server)

The api-server is deployed to **AWS App Runner**, backed by **RDS PostgreSQL 16**, with secrets in **AWS Secrets Manager** and the Docker image stored in **ECR**. This document covers the current deployment, how to reproduce it, how to point a local admin-panel at it, and how to tear it down.

The frontend (`admin-panel`) is **not** deployed here — it runs locally or on Vercel and talks to this API over HTTPS.

## Live environment

| Field | Value |
|---|---|
| Region | `us-east-1` |
| API base URL | `https://jjm59vpn3y.us-east-1.awsapprunner.com` |
| Health check | `GET /api/healthz` → `{"status":"ok"}` |
| Admin credentials (seeded) | `admin@signalaeo.com` / `Admin123!` |
| DB endpoint | `aeo-admin-db.cwvwsawae95c.us-east-1.rds.amazonaws.com:5432` |
| DB name | `seo_network_planner` |
| Secrets Manager entry | `aeo-admin/prod` (DATABASE_URL, SESSION_SECRET) |
| ECR repo | `788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api` |
| App Runner service | `aeo-admin-api` |

> **Note:** the admin credentials are test-only. Rotate before anything real goes here.

## Architecture

```
                   ┌──────────────────────────────┐
 Internet  ───▶   │   App Runner                  │
                   │   (0.25 vCPU / 0.5 GB)        │
                   │   TLS, auto-scale, /api/*    │
                   └──────┬────────────┬───────────┘
                          │            │
             reads env    │            │  SQL over TLS
             from         ▼            ▼
            ┌──────────────────┐  ┌──────────────────────┐
            │ Secrets Manager  │  │ RDS Postgres 16       │
            │ aeo-admin/prod   │  │ db.t4g.micro, 20 GB   │
            │ DATABASE_URL     │  │ Single-AZ, encrypted  │
            │ SESSION_SECRET   │  │ 1-day backups         │
            └──────────────────┘  └──────────────────────┘

Supporting:
- ECR repo `aeo-admin-api` — container image
- IAM roles
   - `aeo-apprunner-ecr`      — App Runner pulls from ECR
   - `aeo-apprunner-instance` — running container reads the secret
- Security group `sg-...`    — Postgres ingress (currently 0.0.0.0/0 for test)
- Subnet group `aeo-rds-subnets` — us-east-1a/b/c
```

## What happens at runtime

1. App Runner pulls the `:latest` tag from ECR on every deploy.
2. On container boot, App Runner injects `DATABASE_URL` and `SESSION_SECRET` as env vars, resolved from Secrets Manager JSON keys via the instance role.
3. `lib/db/src/index.ts` detects the `*.rds.amazonaws.com` hostname and enables TLS (`rejectUnauthorized: false`) automatically.
4. Express mounts all routes under `/api` (see `src/app.ts`).
5. Health checks hit `GET /api/healthz` every 10s.

## Prerequisites

- AWS account with an IAM user that has `AdministratorAccess` (or scoped-down permissions for RDS, ECR, App Runner, Secrets Manager, IAM, and EC2).
- AWS CLI v2, configured: `aws configure --profile aeo-admin`
- Docker Desktop (with buildx and multi-platform support)
- `pnpm` (repo uses pnpm workspaces)
- A `.env` at the repo root with at least `DATABASE_URL` (used for migration/seed steps)

## Reproducing this deployment from scratch

All commands below use `--profile aeo-admin --region us-east-1`. Adjust if your profile or region differ.

### 1. Networking

```bash
# Discover default VPC + subnets
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text \
  --profile aeo-admin --region us-east-1)

aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID \
  --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output table \
  --profile aeo-admin --region us-east-1

# Create RDS security group
SG_ID=$(aws ec2 create-security-group \
  --group-name aeo-rds-sg \
  --description "AEO Admin RDS" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text \
  --profile aeo-admin --region us-east-1)

# Allow inbound Postgres (test-only! lock this down for prod)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID --protocol tcp --port 5432 --cidr 0.0.0.0/0 \
  --profile aeo-admin --region us-east-1

# Subnet group (pick 3 subnets across different AZs from the table above)
aws rds create-db-subnet-group \
  --db-subnet-group-name aeo-rds-subnets \
  --db-subnet-group-description "AEO Admin default VPC" \
  --subnet-ids subnet-AAA subnet-BBB subnet-CCC \
  --profile aeo-admin --region us-east-1
```

### 2. RDS PostgreSQL

```bash
# Generate a strong password locally — do not paste it anywhere
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)
echo "$DB_PASSWORD" > /tmp/aeo-db-password
chmod 600 /tmp/aeo-db-password

aws rds create-db-instance \
  --db-instance-identifier aeo-admin-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16.3 \
  --allocated-storage 20 --storage-type gp3 \
  --master-username postgres --master-user-password "$DB_PASSWORD" \
  --db-name seo_network_planner \
  --vpc-security-group-ids $SG_ID \
  --db-subnet-group-name aeo-rds-subnets \
  --publicly-accessible \
  --backup-retention-period 1 --no-multi-az \
  --storage-encrypted \
  --profile aeo-admin --region us-east-1

# Wait ~8-12 min
aws rds wait db-instance-available \
  --db-instance-identifier aeo-admin-db \
  --profile aeo-admin --region us-east-1

# Grab the endpoint
DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier aeo-admin-db \
  --query 'DBInstances[0].Endpoint.Address' --output text \
  --profile aeo-admin --region us-east-1)
```

### 3. Secrets Manager

```bash
DB_PASSWORD=$(cat /tmp/aeo-db-password)
SESSION_SECRET=$(openssl rand -hex 32)

aws secretsmanager create-secret \
  --name aeo-admin/prod \
  --description "AEO Admin production secrets" \
  --secret-string "{\"DATABASE_URL\":\"postgresql://postgres:${DB_PASSWORD}@${DB_ENDPOINT}:5432/seo_network_planner\",\"SESSION_SECRET\":\"${SESSION_SECRET}\"}" \
  --profile aeo-admin --region us-east-1
```

### 4. Initial DB schema + admin user

From the repo root, using `uselibpqcompat=true&sslmode=require` so drizzle-kit talks TLS to RDS:

```bash
DB_PASSWORD=$(cat /tmp/aeo-db-password)
export DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@${DB_ENDPOINT}:5432/seo_network_planner?uselibpqcompat=true&sslmode=require"

# Push the Drizzle schema — creates all 23 tables
pnpm --filter @workspace/db run push-force

# Seed the admin user — uses the same SESSION_SECRET the server will read at runtime
export SESSION_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id aeo-admin/prod --profile aeo-admin --region us-east-1 \
  --query 'SecretString' --output text | \
  python3 -c "import sys, json; print(json.loads(sys.stdin.read())['SESSION_SECRET'])")
scripts/node_modules/.bin/tsx scripts/seed-admin.ts
```

> **Important:** the admin password hash is derived from `SESSION_SECRET`. If you re-seed with a different `SESSION_SECRET`, login will break. Always read it from the secret above.

### 5. ECR repo

```bash
aws ecr create-repository \
  --repository-name aeo-admin-api \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability MUTABLE \
  --profile aeo-admin --region us-east-1
```

### 6. Build and push the Docker image

```bash
# Log Docker in to ECR
aws ecr get-login-password --region us-east-1 --profile aeo-admin | \
  docker login --username AWS --password-stdin \
  788269087294.dkr.ecr.us-east-1.amazonaws.com

# Build for linux/amd64 (App Runner is x86_64)
docker build \
  --platform linux/amd64 \
  -f artifacts/api-server/Dockerfile \
  -t aeo-admin-api:latest .

docker tag aeo-admin-api:latest \
  788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api:latest

docker push 788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api:latest
```

The `Dockerfile` is a multi-stage build (pnpm install → esbuild bundle → slim runtime). Final image is ~150 MB with no `node_modules` at runtime — everything is bundled into `dist/index.mjs`.

### 7. IAM roles

```bash
# Trust policies
cat > /tmp/apprunner-ecr-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

cat > /tmp/apprunner-instance-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

# ECR access role
aws iam create-role --role-name aeo-apprunner-ecr \
  --assume-role-policy-document file:///tmp/apprunner-ecr-trust.json \
  --profile aeo-admin
aws iam attach-role-policy --role-name aeo-apprunner-ecr \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess \
  --profile aeo-admin

# Instance role (runs inside the container)
aws iam create-role --role-name aeo-apprunner-instance \
  --assume-role-policy-document file:///tmp/apprunner-instance-trust.json \
  --profile aeo-admin

# Grant instance role access to the specific secret
cat > /tmp/apprunner-secrets-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:GetSecretValue",
    "Resource": "arn:aws:secretsmanager:us-east-1:788269087294:secret:aeo-admin/prod-*"
  }]
}
EOF
aws iam put-role-policy --role-name aeo-apprunner-instance \
  --policy-name read-aeo-secrets \
  --policy-document file:///tmp/apprunner-secrets-policy.json \
  --profile aeo-admin
```

### 8. App Runner service

```bash
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id aeo-admin/prod \
  --profile aeo-admin --region us-east-1 --query 'ARN' --output text)

cat > /tmp/apprunner-config.json <<EOF
{
  "ServiceName": "aeo-admin-api",
  "SourceConfiguration": {
    "AuthenticationConfiguration": {
      "AccessRoleArn": "arn:aws:iam::788269087294:role/aeo-apprunner-ecr"
    },
    "AutoDeploymentsEnabled": false,
    "ImageRepository": {
      "ImageIdentifier": "788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "PORT": "8080"
        },
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URL": "${SECRET_ARN}:DATABASE_URL::",
          "SESSION_SECRET": "${SECRET_ARN}:SESSION_SECRET::"
        }
      }
    }
  },
  "InstanceConfiguration": {
    "Cpu": "256",
    "Memory": "512",
    "InstanceRoleArn": "arn:aws:iam::788269087294:role/aeo-apprunner-instance"
  },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP",
    "Path": "/api/healthz",
    "Interval": 10, "Timeout": 5,
    "HealthyThreshold": 2, "UnhealthyThreshold": 5
  }
}
EOF

aws apprunner create-service --cli-input-json file:///tmp/apprunner-config.json \
  --profile aeo-admin --region us-east-1
```

Takes ~3–5 minutes to reach `RUNNING`. Poll with:

```bash
aws apprunner describe-service --service-arn <ARN> \
  --profile aeo-admin --region us-east-1 \
  --query 'Service.Status' --output text
```

### 9. Smoke test

```bash
curl https://jjm59vpn3y.us-east-1.awsapprunner.com/api/healthz
# → {"status":"ok"}
```

## Redeploying after a code change

```bash
# 1. Rebuild
docker build --platform linux/amd64 \
  -f artifacts/api-server/Dockerfile \
  -t aeo-admin-api:latest .

# 2. Tag + push
docker tag aeo-admin-api:latest \
  788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api:latest
docker push \
  788269087294.dkr.ecr.us-east-1.amazonaws.com/aeo-admin-api:latest

# 3. Tell App Runner to roll forward (pulls :latest again)
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:us-east-1:788269087294:service/aeo-admin-api/<HASH> \
  --profile aeo-admin --region us-east-1
```

If the schema changed:

```bash
DB_PASSWORD=$(cat /tmp/aeo-db-password)
export DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@${DB_ENDPOINT}:5432/seo_network_planner?uselibpqcompat=true&sslmode=require"
pnpm --filter @workspace/db run push-force
```

## Using this BE with a local admin-panel

In `artifacts/admin-panel/.env.local`, set:

```
VITE_API_URL=https://jjm59vpn3y.us-east-1.awsapprunner.com
```

Then run the admin-panel normally:

```bash
pnpm --filter admin-panel run dev
```

The api-server's CORS config allows `http://localhost:*` (see `src/app.ts`), so browser requests from the dev server will pass CORS.

### ⚠️ Cross-origin session cookie caveat

The session cookie is currently set with `sameSite: "lax"` and `secure: false`. When the browser is on `http://localhost:5173` and the API is on `https://....awsapprunner.com`, that's a **cross-site** request, and `lax` cookies are only sent on top-level navigations — not on fetches. That means login will return 200 and set the cookie, but subsequent authenticated requests will fail with 401.

**Three ways to handle this:**

1. **Use ngrok** to tunnel your local FE — ngrok URLs match the regex allowlist and keep you on HTTPS the whole way. Also the simplest.
2. **Patch the api-server** to use `sameSite: "none"` + `secure: true` in production (requires a redeploy):
   ```ts
   cookie: {
     secure: process.env.NODE_ENV === "production",
     sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
     httpOnly: true,
     maxAge: 1000 * 60 * 60 * 24 * 7,
   }
   ```
3. **Deploy the FE too** (Vercel or similar) and access everything over HTTPS on the same root domain. Cleanest long-term.

Option 2 is the real fix; option 1 is the fastest local workaround.

## Tear-down

When you're done testing:

```bash
# Order matters — App Runner first, then the DB, secret, repo

aws apprunner delete-service \
  --service-arn arn:aws:apprunner:us-east-1:788269087294:service/aeo-admin-api/<HASH> \
  --profile aeo-admin --region us-east-1

aws rds delete-db-instance \
  --db-instance-identifier aeo-admin-db \
  --skip-final-snapshot --delete-automated-backups \
  --profile aeo-admin --region us-east-1

aws secretsmanager delete-secret \
  --secret-id aeo-admin/prod \
  --force-delete-without-recovery \
  --profile aeo-admin --region us-east-1

aws ecr delete-repository \
  --repository-name aeo-admin-api --force \
  --profile aeo-admin --region us-east-1

# Optional: detach/delete the IAM roles and security group
aws iam detach-role-policy --role-name aeo-apprunner-ecr \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess \
  --profile aeo-admin
aws iam delete-role --role-name aeo-apprunner-ecr --profile aeo-admin
aws iam delete-role-policy --role-name aeo-apprunner-instance --policy-name read-aeo-secrets --profile aeo-admin
aws iam delete-role --role-name aeo-apprunner-instance --profile aeo-admin
aws rds delete-db-subnet-group --db-subnet-group-name aeo-rds-subnets --profile aeo-admin --region us-east-1
aws ec2 delete-security-group --group-id sg-00333a72f12363b68 --profile aeo-admin --region us-east-1
```

RDS takes ~5 min to fully delete. Everything else is near-instant.

## Running cost (rough)

| Resource | Idle cost |
|---|---|
| RDS `db.t4g.micro` (Single-AZ, 20 GB gp3) | ~$0.017/hr + $2.30/mo storage ≈ **$15/mo** |
| App Runner 0.25 vCPU / 0.5 GB (provisioned) | ~$0.007/hr ≈ **$5/mo** |
| ECR storage + data transfer | pennies |
| Secrets Manager (1 secret, few reads) | ~$0.40/mo |
| **Total** | **~$20/mo** while running 24/7 |

Free tier eligible? RDS `db.t4g.micro` is free for 12 months on new accounts.

## Known limitations / things to fix before real prod

- [ ] **Security group is wide open** (`0.0.0.0/0` on 5432). Lock down to the App Runner VPC connector egress or a bastion.
- [ ] **App Runner to RDS goes over the public internet.** Fine for test, but real prod should use an App Runner VPC connector so traffic stays in the VPC.
- [ ] **Session cookie config** (`sameSite: "lax"`, `secure: false`) breaks cross-origin auth — see the caveat above.
- [ ] **Multi-AZ is off.** RDS is single-AZ only. Turn on `--multi-az` for prod resilience (doubles the cost).
- [ ] **No CI/CD.** Every deploy is a manual `docker push` + `start-deployment`. Hook into GitHub Actions before onboarding a team.
- [ ] **No custom domain.** Uses the App Runner-generated `*.awsapprunner.com` URL. Add a Route 53 record + ACM cert for prod.
- [ ] **Admin password is `Admin123!`.** Obviously.
- [ ] **Secrets rotation.** Secrets Manager supports automatic rotation; not enabled.

## Troubleshooting

### `drizzle-kit push` hangs forever

RDS requires TLS. Make sure the DATABASE_URL includes `?uselibpqcompat=true&sslmode=require`, or use the updated `lib/db/drizzle.config.ts` which auto-enables TLS for `*.rds.amazonaws.com` hostnames.

### App Runner stuck in `OPERATION_IN_PROGRESS`

The health check path is probably wrong. Routes mount at `/api`, so the health path is `/api/healthz` — not `/healthz`. While a create is in progress you **cannot** update or delete the service; you have to wait for `CREATE_FAILED` (~25 min), then delete and recreate.

**Diagnose by running the container locally first:**

```bash
DB_PASSWORD=$(cat /tmp/aeo-db-password)
docker run --rm -p 18080:8080 \
  -e PORT=8080 -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@${DB_ENDPOINT}:5432/seo_network_planner" \
  -e SESSION_SECRET=test \
  aeo-admin-api:latest
```

Then `curl http://localhost:18080/api/healthz`. If that works, the path is correct.

### Login returns 200 but follow-up requests are 401

See the [cross-origin cookie caveat](#️-cross-origin-session-cookie-caveat) above.

### `no pg_hba.conf entry for host ... no encryption`

The client isn't using TLS. Either:
- append `?sslmode=require` to `DATABASE_URL`, or
- make sure the client uses `ssl: { rejectUnauthorized: false }` (this is what `lib/db/src/index.ts` does automatically for RDS hostnames).

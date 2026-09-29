# Tests the Microsoft setup for the HRMS leave approval cards.
#   Test 1: can the app send email from the sender mailbox?
#   Test 2: does Outlook show the leave card with Approve / Deny buttons?
#
# Values are read from .env.local in the project folder (never committed):
#   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_EMAIL,
#   TEST_RECEIVER_EMAIL, AM_ORIGINATOR_ID (optional), APP_PUBLIC_URL
#
# Tip: if MS_SENDER_EMAIL and TEST_RECEIVER_EMAIL are the same (your own email),
# the card shows without a Provider ID, which is handy for testing.
#
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts\test-microsoft.ps1

$ErrorActionPreference = "Stop"

# ======== Read values from .env.local ========
$envFile = Join-Path (Get-Location) ".env.local"
if (-not (Test-Path $envFile)) { Write-Host "Not found: $envFile (run this from the project folder)" -ForegroundColor Red; exit 1 }
$vals = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { $vals[$matches[1]] = $matches[2].Trim().Trim('"') }
}
foreach ($n in 'MS_TENANT_ID','MS_CLIENT_ID','MS_CLIENT_SECRET','MS_SENDER_EMAIL','TEST_RECEIVER_EMAIL') {
  if (-not $vals[$n]) { Write-Host "Missing $n in .env.local" -ForegroundColor Red; exit 1 }
}
$tenant     = "$($vals['MS_TENANT_ID'])"
$client     = "$($vals['MS_CLIENT_ID'])"
$secret     = "$($vals['MS_CLIENT_SECRET'])"
$sender     = "$($vals['MS_SENDER_EMAIL'])"
$to         = "$($vals['TEST_RECEIVER_EMAIL'])"
$originator = "$($vals['AM_ORIGINATOR_ID'])"
$portal     = "$($vals['APP_PUBLIC_URL'])"
# =============================================

function Show-GraphError($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { Write-Host $err.ErrorDetails.Message -ForegroundColor Red }
  else { Write-Host $err.Exception.Message -ForegroundColor Red }
}

function Send-Mail($subject, $html) {
  $body = @{
    message = @{
      subject = $subject
      body = @{ contentType = "HTML"; content = $html }
      toRecipients = @(@{ emailAddress = @{ address = $to } })
    }
    saveToSentItems = $false
  } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/users/$sender/sendMail" `
    -Headers @{ Authorization = "Bearer $script:token" } -ContentType "application/json" -Body $body | Out-Null
}

# ======== Sign in ========
Write-Host "`nSigning in to Microsoft..." -ForegroundColor Cyan
try {
  $tok = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenant/oauth2/v2.0/token" -Body @{
    client_id = $client; client_secret = $secret
    scope = "https://graph.microsoft.com/.default"; grant_type = "client_credentials"
  }
  $script:token = $tok.access_token
  Write-Host "OK: signed in." -ForegroundColor Green
} catch {
  Write-Host "FAILED: sign-in. Check the tenant ID, client ID, and that you used the secret VALUE (not its ID)." -ForegroundColor Red
  Show-GraphError $_
  exit 1
}

# ======== Test 1: plain email ========
Write-Host "`nTest 1: sending a plain email..." -ForegroundColor Cyan
try {
  Send-Mail "HRMS test email" "<p>If you can read this, sending works.</p>"
  Write-Host "OK: email sent to $to. Check your inbox." -ForegroundColor Green
} catch {
  Write-Host "FAILED: sending. A 403 usually means admin consent is missing, or the mailbox restriction does not include $sender." -ForegroundColor Red
  Show-GraphError $_
  exit 1
}

# ======== Test 2: leave card ========
$selfSend = ($sender -ieq $to)
if ([string]::IsNullOrWhiteSpace($portal)) {
  Write-Host "`nSkipped Test 2 (APP_PUBLIC_URL is empty)." -ForegroundColor Yellow
} elseif ([string]::IsNullOrWhiteSpace($originator) -and -not $selfSend) {
  Write-Host "`nSkipped Test 2 (a Provider ID is needed unless the sender and receiver are the same)." -ForegroundColor Yellow
} else {
  Write-Host "`nTest 2: sending a sample LEAVE card..." -ForegroundColor Cyan
  $decisionUrl = "$($portal.TrimEnd('/'))/api/public/leave/decision"
  $jsonHeaders = @(@{ name = "Content-Type"; value = "application/json" })
  $cardObj = [ordered]@{
    '$schema' = "http://adaptivecards.io/schemas/adaptive-card.json"
    type = "AdaptiveCard"; version = "1.0"
    hideOriginalBody = $true
    body = @(
      @{ type = "TextBlock"; text = "Leave request"; weight = "Bolder"; size = "Medium" },
      @{ type = "TextBlock"; text = "Test Employee has applied for leave."; wrap = $true },
      @{ type = "FactSet"; facts = @(
          @{ title = "Employee"; value = "Test Employee" },
          @{ title = "Leave type"; value = "Annual leave" },
          @{ title = "From"; value = "2026-10-01" },
          @{ title = "To"; value = "2026-10-03" },
          @{ title = "Duration"; value = "3 days" },
          @{ title = "Reason"; value = "Test - please ignore" }
      ) }
    )
    actions = @(
      @{ type = "Action.Http"; title = "Approve"; method = "POST"; url = $decisionUrl
         headers = $jsonHeaders; body = '{"requestId":"test","action":"approve"}' },
      @{ type = "Action.ShowCard"; title = "Deny"; card = [ordered]@{
          type = "AdaptiveCard"; version = "1.0"
          body = @(@{ type = "Input.Text"; id = "reason"; placeholder = "Reason for denying (required)"; isMultiline = $true })
          actions = @(@{ type = "Action.Http"; title = "Deny request"; method = "POST"; url = $decisionUrl
                         headers = $jsonHeaders; body = '{"requestId":"test","action":"deny","reason":"{{reason.value}}"}' })
      } }
    )
  }
  if (-not [string]::IsNullOrWhiteSpace($originator)) { $cardObj["originator"] = $originator }
  $card = ($cardObj | ConvertTo-Json -Depth 20 -Compress).Replace("<", "\u003c")
  $html = "<html><head><meta http-equiv=`"Content-Type`" content=`"text/html; charset=utf-8`"><script type=`"application/adaptivecard+json`">$card</script></head><body><p>Leave card test: if you only see this text, the card did not render.</p></body></html>"
  try {
    Send-Mail "Leave approval: Test Employee (card test)" $html
    Write-Host "OK: leave card sent. Open it in Outlook." -ForegroundColor Green
    Write-Host "  You should see the leave details with Approve and Deny buttons."
  } catch {
    Write-Host "FAILED: sending the card email." -ForegroundColor Red
    Show-GraphError $_
  }
}

$secret = $null; $script:token = $null
Write-Host "`nDone." -ForegroundColor Cyan
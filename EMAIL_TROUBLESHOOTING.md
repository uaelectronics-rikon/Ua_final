# 📧 Email Service Troubleshooting Guide

## Quick Links
- **📊 Monitor**: http://localhost:3000/email-monitor
- **API Status**: http://localhost:3000/api/email-queue/status
- **API Logs**: http://localhost:3000/api/email-queue/logs

## 🔴 "Emails Not Sending After Deployment"

This is typically caused by one of these issues:

### 1. **Environment Variables Not Set on Deployment Platform** ⚠️
**Most Common Issue!**

Your deployment platform (Render, Railway, Heroku, etc.) needs to have these environment variables configured:

```
EMAIL_USER=rikon@uaelectronicsindia.com
EMAIL_PASS=yhwmxhnmihztnlty
NODE_ENV=production
PORT=3000
```

**How to fix on Render:**
1. Go to your Render dashboard
2. Select your service
3. Click "Environment" tab
4. Add the variables above
5. Redeploy

**How to fix on Railway:**
1. Go to your Railway project
2. Click "Variables" tab
3. Add the variables above
4. Redeploy

### 2. **Google App Password Expired or Invalid**

Nodemailer requires a **16-character Google App Password**, NOT your account password.

**How to generate/reset:**
1. Sign in to: https://myaccount.google.com/
2. Click "Security" in the left menu
3. Scroll down to "App passwords"
4. Select "Mail" and "Windows Computer" (or your device)
5. Copy the 16-character password (no spaces)
6. Update `EMAIL_PASS` environment variable on your deployment platform

### 3. **2-Step Verification Not Enabled**

Google App Passwords ONLY work if 2-Step Verification is enabled on your account.

**How to enable:**
1. Go to: https://myaccount.google.com/security
2. Click "2-Step Verification"
3. Follow the setup wizard
4. Return to App Passwords and generate a new password

### 4. **DNS Issues (Render/Railway Specific)**

When deploying on cloud platforms, DNS resolution can be slow at startup, causing:
```
Error: getaddrinfo EAI_AGAIN smtp.gmail.com
```

**This is NORMAL!** The email service will retry and work after 5-30 seconds.

**Solutions:**
- ✅ Just wait 30 seconds and test again
- ✅ Emails queued while DNS was down will retry automatically
- ✅ Use the monitoring dashboard to see retry status
- ✅ Monitor dashboard available at: http://yoursite.com/email-monitor

## 🟢 Email Service Features

### Automatic Retry System
- Failed emails are automatically queued for retry
- Retries happen every 5 minutes
- Exponential backoff: 2s → 4s → 8s → ... → 300s (max)
- Max 10 retry attempts before marking as failed

### Monitoring Dashboard
Access the email monitoring dashboard:
```
http://your-server/email-monitor
```

Features:
- Real-time queue statistics (pending, failed, total)
- Recent email delivery logs
- Manual retry button
- Clear queue button
- Auto-refresh every 30 seconds

### API Endpoints

**Get Queue Status:**
```bash
curl http://localhost:3000/api/email-queue/status
```

Response:
```json
{
  "queueStats": {
    "total": 5,
    "pending": 3,
    "failed": 2
  },
  "recentLogs": [
    {
      "timestamp": "2025-01-10T12:30:45Z",
      "to": "customer@example.com",
      "orderId": "UAE1234567890",
      "success": true,
      "error": null
    }
  ]
}
```

**Get Email Logs (Last N):**
```bash
curl http://localhost:3000/api/email-queue/logs?limit=50
```

**Retry All Failed Emails:**
```bash
curl -X POST http://localhost:3000/api/email-queue/retry-all
```

**Clear Queue:**
```bash
curl -X DELETE http://localhost:3000/api/email-queue/clear
```

## 🧪 Local Testing

### Test Email Sending
The server has a `/test-email` endpoint for testing:

```bash
curl -X POST http://localhost:3000/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@gmail.com"}'
```

### Manual Testing Steps

1. **Verify Environment Variables:**
   ```bash
   echo $EMAIL_USER
   echo $EMAIL_PASS
   ```

2. **Check Server Logs:**
   ```
   npm run dev
   # Look for: ✅ EMAIL SERVICE VERIFIED SUCCESSFULLY!
   ```

3. **Test Email Queue:**
   ```bash
   # Place an order or use test endpoint
   curl http://localhost:3000/email-monitor
   ```

4. **Monitor Real-time:**
   ```bash
   # In another terminal, watch the logs
   tail -f server.log
   ```

## 📋 Troubleshooting Checklist

- [ ] EMAIL_USER is set to: `rikon@uaelectronicsindia.com`
- [ ] EMAIL_PASS is 16 characters (no spaces)
- [ ] EMAIL_PASS is from https://myaccount.google.com/apppasswords
- [ ] 2-Step Verification is enabled
- [ ] Environment variables set on deployment platform
- [ ] Server restarted after environment variable changes
- [ ] Firewall allows outbound port 587 (STARTTLS)
- [ ] No "Gmail blocked" warning for the account
- [ ] .env file is NOT in .gitignore (dev only) ⚠️

## 🔧 Common Error Codes

| Error Code | Meaning | Solution |
|-----------|---------|----------|
| EAUTH | Authentication failed | Check EMAIL_PASS, verify 2FA enabled |
| EAI_AGAIN | DNS resolution failed | Wait 30 seconds, retry (normal on cloud) |
| ENOTFOUND | Cannot find smtp.gmail.com | Check internet/firewall, port 587 open |
| ETIMEDOUT | Connection timeout | Check network, try restarting server |
| ECONNREFUSED | Connection refused | Port 587 blocked, check firewall |

## 📧 Gmail SMTP Settings

- **Host:** smtp.gmail.com
- **Port:** 587 (STARTTLS - NOT 465 SSL)
- **Username:** rikon@uaelectronicsindia.com
- **Password:** 16-char App Password
- **TLS:** Enabled (STARTTLS)
- **IPv4 Force:** Yes (for cloud compatibility)

## 🚀 Deployment Checklist

Before deploying to production:

1. ✅ Test locally with `npm run dev`
2. ✅ Place a test order and confirm email received
3. ✅ Check email-monitor at http://localhost:3000/email-monitor
4. ✅ Add EMAIL_USER and EMAIL_PASS to deployment environment
5. ✅ Redeploy application
6. ✅ Wait 30 seconds for DNS to resolve (if cloud platform)
7. ✅ Test production email with test order
8. ✅ Monitor http://your-site.com/email-monitor for any failures

## 💡 Pro Tips

1. **Monitor email logs regularly** - Check /email-monitor dashboard to catch issues early
2. **Test deployment environment first** - Place a small test order to verify emails work
3. **Keep App Password safe** - Never commit .env to Git
4. **Check spam folder** - Gmail sometimes tags bulk mail as spam
5. **Set up email forwarding** - Forward noreply@ to a monitored email account

## 📞 Still Not Working?

**Check these files for logs:**
- `data/email-queue.json` - Queued emails
- `data/email-log.json` - Email delivery history
- Server console output (`npm run dev`)

**Check the email-monitor dashboard:**
```
http://localhost:3000/email-monitor
```

This will show:
- Number of pending emails
- Number of failed emails
- Recent delivery logs with error messages
- Ability to retry manually

If emails show as "Failed" with error code "EAUTH", the password is wrong or 2FA is not enabled.

---

**Last Updated:** January 2025
**Version:** 1.0 (Queue System with Auto-Retry)

---
title: गैर-कॉम्पैक्शन ऑटो-रिट्राई नीति
description: कॉम्पैक्शन पथ के बाहर क्षणिक API विफलताओं के लिए ऑटो-रिट्राई नीति।
sidebar:
  order: 6
  label: रिट्राई नीति
i18n:
  sourceHash: 8999a0258dd8
  translator: machine
---

# गैर-कॉम्पैक्शन ऑटो-रिट्राई नीति

यह दस्तावेज़ `AgentSession` में मानक API-त्रुटि रिट्राई पथ का वर्णन करता है।

यह स्पष्ट रूप से ऑटो-कॉम्पैक्शन के माध्यम से संदर्भ-ओवरफ्लो पुनर्प्राप्ति को बाहर करता है। ओवरफ्लो को कॉम्पैक्शन लॉजिक द्वारा संभाला जाता है और इसे [`compaction.md`](./compaction.md) में अलग से प्रलेखित किया गया है।

## कार्यान्वयन फ़ाइलें

- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/config/settings-schema.ts`](../../packages/coding-agent/src/config/settings-schema.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts)
- [`../src/modes/rpc/rpc-client.ts`](../../packages/coding-agent/src/modes/rpc/rpc-client.ts)
- [`../src/modes/rpc/rpc-types.ts`](../../packages/coding-agent/src/modes/rpc/rpc-types.ts)

## कॉम्पैक्शन बनाम दायरे की सीमा

रिट्राई और कॉम्पैक्शन दोनों एक ही `agent_end` पथ से जाँचे जाते हैं, लेकिन उन्हें जानबूझकर अलग रखा गया है:

1. `agent_end` अंतिम असिस्टेंट संदेश का निरीक्षण करता है।
2. `#isRetryableError(...)` पहले चलता है।
3. यदि रिट्राई शुरू होती है, तो उस टर्न के लिए कॉम्पैक्शन जाँच छोड़ दी जाती है।
4. संदर्भ-ओवरफ्लो त्रुटियाँ रिट्राई वर्गीकरण से पूरी तरह बाहर कर दी जाती हैं (`isContextOverflow(...)` रिट्राई को शॉर्ट-सर्किट करता है)।
5. ओवरफ्लो इसलिए मानक रिट्राई के बजाय `#checkCompaction(...)` में जाता है।

अतः: ओवरलोड/रेट/सर्वर/नेटवर्क-शैली की विफलताएँ इस रिट्राई नीति का उपयोग करती हैं; संदर्भ-विंडो ओवरफ्लो कॉम्पैक्शन पुनर्प्राप्ति का उपयोग करता है।

## रिट्राई वर्गीकरण

`#isRetryableError(...)` के लिए निम्नलिखित सभी शर्तें पूरी होनी चाहिए:

- असिस्टेंट `stopReason === "error"`
- `errorMessage` मौजूद हो
- संदेश **संदर्भ ओवरफ्लो नहीं** है
- `errorMessage` `#isRetryableErrorMessage(...)` से मेल खाता हो

वर्तमान रिट्राईयोग्य पैटर्न सेट (regex-आधारित):

- overloaded
- rate limit / usage limit / too many requests
- HTTP-जैसी सर्वर श्रेणियाँ: 429, 500, 502, 503, 504
- service unavailable / server error / internal error
- connection error / fetch failed
- `retry delay` शब्दावली

यह string-pattern वर्गीकरण है, typed provider error codes नहीं।

## रिट्राई जीवनचक्र और स्थिति संक्रमण

रिट्राई द्वारा उपयोग की जाने वाली सत्र स्थिति:

- `#retryAttempt: number` (`0` का अर्थ है निष्क्रिय)
- `#retryPromise: Promise<void> | undefined` (प्रगतिशील रिट्राई जीवनचक्र को ट्रैक करता है)
- `#retryResolve: (() => void) | undefined` (`#retryPromise` को रिज़ॉल्व करता है)
- `#retryAbortController: AbortController | undefined` (backoff sleep को रद्द करता है)

प्रवाह (`#handleRetryableError`):

1. `retry` सेटिंग्स समूह पढ़ें।
2. यदि `retry.enabled === false`, तो तुरंत रुकें (`false`, कोई रिट्राई शुरू नहीं)।
3. `#retryAttempt` बढ़ाएँ।
4. `#retryPromise` एक बार बनाएँ (एक श्रृंखला में पहला प्रयास)।
5. यदि प्रयास `retry.maxRetries` से अधिक हो गया, तो अंतिम विफलता इवेंट emit करें और रुकें।
6. देरी की गणना करें: `retry.baseDelayMs * 2^(attempt-1)`।
7. usage-limit त्रुटियों के लिए, रिट्राई संकेत पार्स करें और auth storage (`markUsageLimitReached(...)`) को कॉल करें; यदि provider/model स्विच सफल होता है, तो देरी को `0` पर बाध्य करें।
8. `auto_retry_start` emit करें।
9. agent runtime स्थिति से trailing असिस्टेंट त्रुटि संदेश हटाएँ (persisted session history में बना रहता है)।
10. abort समर्थन के साथ sleep करें।
11. जागने पर, `setTimeout(..., 0)` के माध्यम से `agent.continue()` शेड्यूल करें।

### रिट्राई काउंटर क्या रीसेट करता है

`#retryAttempt` इन स्थितियों में `0` पर रीसेट होता है:

- रिट्राई शुरू होने के बाद पहला सफल गैर-त्रुटि, गैर-aborted असिस्टेंट संदेश (`auto_retry_end { success: true }` emit करता है)
- backoff sleep के दौरान रिट्राई रद्दीकरण
- अधिकतम रिट्राई से अधिक होने का पथ

`#retryPromise` रिट्राई श्रृंखला समाप्त होने पर (सफलता, रद्दीकरण, या max-exceeded) `#resolveRetry()` के माध्यम से रिज़ॉल्व/क्लियर होता है।

## Backoff और अधिकतम-प्रयास शब्दार्थ

सेटिंग्स:

- `retry.enabled` (डिफ़ॉल्ट `true`)
- `retry.maxRetries` (डिफ़ॉल्ट `3`)
- `retry.baseDelayMs` (डिफ़ॉल्ट `2000`)

प्रयास क्रमांकन:

- अधिकतम-जाँच से पहले प्रयास काउंटर बढ़ाया जाता है
- start इवेंट वर्तमान प्रयास (1-आधारित) का उपयोग करते हैं
- max-exceeded end इवेंट `attempt: this.#retryAttempt - 1` रिपोर्ट करता है (अंतिम प्रयासित रिट्राई गिनती)

डिफ़ॉल्ट सेटिंग्स के साथ Backoff अनुक्रम:

- प्रयास 1: 2000 ms
- प्रयास 2: 4000 ms
- प्रयास 3: 8000 ms

देरी ओवरराइड इनपुट केवल usage-limit हैंडलिंग पथ में उपयोग किए जाते हैं, और केवल auth-storage model/account switching निर्णय को प्रभावित करने के लिए। मुख्य गैर-कॉम्पैक्शन रिट्राई पथ में, backoff स्थानीय exponential देरी बना रहता है जब तक switching सफल न हो (`delayMs = 0`)।

## Abort यांत्रिकी

### स्पष्ट रिट्राई abort

`abortRetry()`:

- `#retryAbortController` को abort करता है (यदि मौजूद हो)
- रिट्राई promise को रिज़ॉल्व करता है (`#resolveRetry()`) ताकि awaiters अनब्लॉक हों

यदि sleep के दौरान abort होता है, तो catch पथ emit करता है:

- `auto_retry_end { success: false, finalError: "Retry cancelled" }`
- attempt/controller रीसेट करता है

### वैश्विक ऑपरेशन abort इंटरैक्शन

`abort()` सक्रिय agent stream को abort करने से पहले `abortRetry()` को कॉल करता है। यह गारंटी देता है कि जब उपयोगकर्ता सामान्य abort जारी करता है तो रिट्राई backoff रद्द हो जाती है।

### TUI इंटरैक्शन

`auto_retry_start` पर, EventController:

- `Esc` हैंडलर को `session.abortRetry()` से बदलता है
- loader टेक्स्ट रेंडर करता है: `Retrying (attempt/maxAttempts) in Ns… (esc to cancel)`

`auto_retry_end` पर, यह पूर्व `Esc` हैंडलर पुनर्स्थापित करता है और loader स्थिति साफ़ करता है।

## स्ट्रीमिंग और prompt completion व्यवहार

`prompt()` अंततः `agent.prompt(...)` वापस आने के बाद `#waitForRetry()` पर प्रतीक्षा करता है।

प्रभाव:

- एक prompt कॉल तब तक पूरी तरह रिज़ॉल्व नहीं होती जब तक कोई भी शुरू की गई रिट्राई श्रृंखला समाप्त नहीं हो जाती (सफलता/विफलता/रद्दीकरण)
- रिट्राई जीवनचक्र एक तार्किक prompt निष्पादन सीमा का हिस्सा है

यह कॉलर्स को एक रिट्राईंग टर्न को बहुत जल्दी पूर्ण मानने से रोकता है।

## नियंत्रण: सेटिंग्स और RPC

### कॉन्फ़िगरेशन knobs

retry समूह के अंतर्गत settings schema में परिभाषित:

- `retry.enabled`
- `retry.maxRetries`
- `retry.baseDelayMs`

सत्र में प्रोग्रामेटिक toggles:

- `setAutoRetryEnabled(enabled)` `retry.enabled` लिखता है
- `autoRetryEnabled` `retry.enabled` पढ़ता है
- `isRetrying` रिपोर्ट करता है कि रिट्राई जीवनचक्र promise सक्रिय है या नहीं

### RPC नियंत्रण

RPC कमांड सतह:

- `set_auto_retry` → `session.setAutoRetryEnabled(command.enabled)`
- `abort_retry` → `session.abortRetry()`

Client सहायक:

- `RpcClient.setAutoRetry(enabled)`
- `RpcClient.abortRetry()`

दोनों कमांड सफलता प्रतिक्रियाएँ लौटाते हैं; रिट्राई प्रगति/विफलता विवरण streamed session events से आते हैं, command response payloads से नहीं।

## इवेंट emission और विफलता प्रकटीकरण

सत्र-स्तरीय रिट्राई इवेंट:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`
- `auto_retry_end { success, attempt, finalError? }`

प्रसार:

- `AgentSession.subscribe(...)` के माध्यम से emit किए गए
- extension runner को extension events के रूप में अग्रेषित
- RPC मोड में, सीधे JSON इवेंट ऑब्जेक्ट के रूप में अग्रेषित (`session.subscribe(event => output(event))`)
- TUI में, loader/error UI के लिए `EventController` द्वारा उपभोग किए गए

अंतिम विफलता प्रकटीकरण:

- max-exceeded या रद्दीकरण पर, `auto_retry_end.success === false`
- TUI दिखाता है: `Retry failed after N attempts: <finalError>`
- Extensions/hooks `auto_retry_end` को समान fields के साथ प्राप्त करते हैं
- RPC उपभोक्ता stdout stream पर समान इवेंट ऑब्जेक्ट प्राप्त करते हैं

## स्थायी stop स्थितियाँ

रिट्राई रुकती है और निम्नलिखित में से कोई भी होने पर ऑटो-continue नहीं करती:

- `retry.enabled` false है
- त्रुटि रिट्राई-वर्गीकृत नहीं है
- त्रुटि संदर्भ ओवरफ्लो है (कॉम्पैक्शन पथ को सौंपी गई)
- अधिकतम रिट्राई से अधिक हो गई
- उपयोगकर्ता रिट्राई रद्द करता है (`abort_retry` या रिट्राई loader के दौरान `Esc`)
- वैश्विक abort (`abort`) पहले रिट्राई को रद्द करता है

काउंटर रीसेट होने के बाद भविष्य की रिट्राईयोग्य त्रुटि पर एक नई रिट्राई श्रृंखला अभी भी शुरू हो सकती है।

## परिचालन चेतावनियाँ

- वर्गीकरण regex टेक्स्ट मिलान है; provider-विशिष्ट structured errors यहाँ उपयोग नहीं किए जाते।
- रिट्राई **runtime context** से विफल असिस्टेंट त्रुटि को re-continue से पहले हटा देती है, लेकिन session history में वह त्रुटि प्रविष्टि बनी रहती है।
- `RpcSessionState` वर्तमान में `autoCompactionEnabled` को उजागर करता है लेकिन `autoRetryEnabled` field नहीं; RPC callers को अपनी toggle स्थिति स्वयं ट्रैक करनी होगी या अन्य APIs के माध्यम से सेटिंग्स क्वेरी करनी होगी।

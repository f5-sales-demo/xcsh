---
title: تخزين الجلسات ونموذج الإدخالات
description: >-
  نموذج تخزين الجلسات بالإلحاق فقط مع أنواع الإدخالات والاستمرارية والترحيل بين
  التنسيقات.
sidebar:
  order: 1
  label: التخزين ونموذج الإدخالات
i18n:
  sourceHash: 42fe17549e00
  translator: machine
---

# تخزين الجلسات ونموذج الإدخالات

هذا المستند هو المرجع الأساسي لكيفية تمثيل جلسات وكيل البرمجة وتخزينها وترحيلها وإعادة بنائها أثناء التشغيل.

## النطاق

يغطي:

- تنسيق JSONL للجلسات وإدارة الإصدارات
- تصنيف الإدخالات ودلالات الشجرة (`id`/`parentId` + مؤشر الورقة)
- سلوك الترحيل/التوافق عند تحميل ملفات قديمة أو تالفة
- إعادة بناء السياق (`buildSessionContext`)
- ضمانات الاستمرارية، سلوك الفشل، الاقتطاع/تخزين الكائنات الكبيرة خارجيًا
- تجريدات التخزين (`FileSessionStorage`، `MemorySessionStorage`) والأدوات المساعدة ذات الصلة

لا يغطي سلوك عرض واجهة `/tree` بخلاف الدلالات التي تؤثر على بيانات الجلسة.

## ملفات التنفيذ

- [`src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`src/session/messages.ts`](../../packages/coding-agent/src/session/messages.ts)
- [`src/session/session-storage.ts`](../../packages/coding-agent/src/session/session-storage.ts)
- [`src/session/history-storage.ts`](../../packages/coding-agent/src/session/history-storage.ts)
- [`src/session/blob-store.ts`](../../packages/coding-agent/src/session/blob-store.ts)

## التخطيط على القرص

موقع ملف الجلسة الافتراضي:

```text
~/.xcsh/agent/sessions/--<cwd-encoded>--/<timestamp>_<sessionId>.jsonl
```

يُشتق `<cwd-encoded>` من مجلد العمل عن طريق إزالة الشرطة المائلة الأولى واستبدال `/` و`\\` و`:` بـ `-`.

موقع مخزن الكائنات الكبيرة:

```text
~/.xcsh/agent/blobs/<sha256>
```

تُكتب ملفات مسار التنقل للطرفية تحت:

```text
~/.xcsh/agent/terminal-sessions/<terminal-id>
```

يتكون محتوى مسار التنقل من سطرين: مجلد العمل الأصلي، ثم مسار ملف الجلسة. تفضل `continueRecent()` هذا المؤشر المحدد بالطرفية قبل البحث عن أحدث وقت تعديل.

## تنسيق الملف

ملفات الجلسات بتنسيق JSONL: كائن JSON واحد لكل سطر.

- السطر الأول هو دائمًا رأس الجلسة (`type: "session"`).
- الأسطر المتبقية هي قيم `SessionEntry`.
- الإدخالات تعمل بوضع الإلحاق فقط أثناء التشغيل؛ التنقل بين الفروع ينقل مؤشرًا (`leafId`) بدلاً من تعديل الإدخالات الموجودة.

### الرأس (`SessionHeader`)

```json
{
  "type": "session",
  "version": 3,
  "id": "1f9d2a6b9c0d1234",
  "timestamp": "2026-02-16T10:20:30.000Z",
  "cwd": "/work/pi",
  "title": "optional session title",
  "parentSession": "optional lineage marker"
}
```

ملاحظات:

- `version` اختياري في ملفات v1؛ غيابه يعني v1.
- `parentSession` هو سلسلة نسب معتمة. الكود الحالي يكتب إما معرّف جلسة أو مسار جلسة حسب التدفق (`fork`، `forkFrom`، `createBranchedSession`، أو `newSession({ parentSession })` صريح). يُعامل كبيانات وصفية وليس مفتاحًا أجنبيًا مُحدد النوع.

### قاعدة الإدخال (`SessionEntryBase`)

جميع الإدخالات غير الرأس تتضمن:

```json
{
  "type": "...",
  "id": "8-char-id",
  "parentId": "previous-or-branch-parent",
  "timestamp": "2026-02-16T10:20:30.000Z"
}
```

يمكن أن يكون `parentId` بقيمة `null` للإدخال الجذري (أول إلحاق، أو بعد `resetLeaf()`).

## تصنيف الإدخالات

`SessionEntry` هو اتحاد من:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `ttsr_injection`
- `session_init`
- `mode_change`

### `message`

يخزن `AgentMessage` مباشرة.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": null,
  "timestamp": "2026-02-16T10:21:00.000Z",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "content": [{ "type": "text", "text": "Done." }],
    "usage": { "input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "timestamp": 1760000000000
  }
}
```

### `model_change`

```json
{
  "type": "model_change",
  "id": "b1c2d3e4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:21:30.000Z",
  "model": "openai/gpt-4o",
  "role": "default"
}
```

`role` اختياري؛ غيابه يُعامل كـ `default` في إعادة بناء السياق.

### `thinking_level_change`

```json
{
  "type": "thinking_level_change",
  "id": "c1d2e3f4",
  "parentId": "b1c2d3e4",
  "timestamp": "2026-02-16T10:22:00.000Z",
  "thinkingLevel": "high"
}
```

### `compaction`

```json
{
  "type": "compaction",
  "id": "d1e2f3a4",
  "parentId": "c1d2e3f4",
  "timestamp": "2026-02-16T10:23:00.000Z",
  "summary": "Conversation summary",
  "shortSummary": "Short recap",
  "firstKeptEntryId": "a1b2c3d4",
  "tokensBefore": 42000,
  "details": { "readFiles": ["src/a.ts"] },
  "preserveData": { "hookState": true },
  "fromExtension": false
}
```

### `branch_summary`

```json
{
  "type": "branch_summary",
  "id": "e1f2a3b4",
  "parentId": "a1b2c3d4",
  "timestamp": "2026-02-16T10:24:00.000Z",
  "fromId": "a1b2c3d4",
  "summary": "Summary of abandoned path",
  "details": { "note": "optional" },
  "fromExtension": true
}
```

إذا كان التفرع من الجذر (`branchFromId === null`)، فإن `fromId` هو السلسلة الحرفية `"root"`.

### `custom`

استمرارية حالة الإضافة؛ يتم تجاهله بواسطة `buildSessionContext`.

```json
{
  "type": "custom",
  "id": "f1a2b3c4",
  "parentId": "e1f2a3b4",
  "timestamp": "2026-02-16T10:25:00.000Z",
  "customType": "my-extension",
  "data": { "state": 1 }
}
```

### `custom_message`

رسالة مقدمة من الإضافة تشارك في سياق النموذج اللغوي الكبير.

```json
{
  "type": "custom_message",
  "id": "a2b3c4d5",
  "parentId": "f1a2b3c4",
  "timestamp": "2026-02-16T10:26:00.000Z",
  "customType": "my-extension",
  "content": "Injected context",
  "display": true,
  "details": { "debug": false }
}
```

### `label`

```json
{
  "type": "label",
  "id": "b2c3d4e5",
  "parentId": "a2b3c4d5",
  "timestamp": "2026-02-16T10:27:00.000Z",
  "targetId": "a1b2c3d4",
  "label": "checkpoint"
}
```

`label: undefined` يمسح التسمية لـ `targetId`.

### `ttsr_injection`

```json
{
  "type": "ttsr_injection",
  "id": "c2d3e4f5",
  "parentId": "b2c3d4e5",
  "timestamp": "2026-02-16T10:28:00.000Z",
  "injectedRules": ["ruleA", "ruleB"]
}
```

### `session_init`

```json
{
  "type": "session_init",
  "id": "d2e3f4a5",
  "parentId": "c2d3e4f5",
  "timestamp": "2026-02-16T10:29:00.000Z",
  "systemPrompt": "...",
  "task": "...",
  "tools": ["read", "edit"],
  "outputSchema": { "type": "object" }
}
```

### `mode_change`

```json
{
  "type": "mode_change",
  "id": "e2f3a4b5",
  "parentId": "d2e3f4a5",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "mode": "plan",
  "data": { "planFile": "/tmp/plan.md" }
}
```

## إدارة الإصدارات والترحيل

إصدار الجلسة الحالي: `3`.

### v1 -> v2

يُطبق عندما يكون `version` في الرأس مفقودًا أو `< 2`:

- يضيف `id` و`parentId` لكل إدخال غير رأسي.
- يعيد بناء سلسلة أصل خطية باستخدام ترتيب الملف.
- يرحّل حقل الضغط `firstKeptEntryIndex` -> `firstKeptEntryId` عند وجوده.
- يضبط `version = 2` في الرأس.

### v2 -> v3

يُطبق عندما يكون `version < 3` في الرأس:

- لإدخالات `message`: يعيد كتابة `message.role === "hookMessage"` القديم إلى `"custom"`.
- يضبط `version = 3` في الرأس.

### محفز الترحيل والاستمرارية

- يتم تشغيل الترحيلات أثناء تحميل الجلسة (`setSessionFile`).
- إذا تم تشغيل أي ترحيل، يُعاد كتابة الملف بالكامل على القرص فورًا.
- يعدّل الترحيل الإدخالات في الذاكرة أولاً، ثم يحفظ JSONL المُعاد كتابته.

## سلوك التحميل والتوافق

سلوك `loadEntriesFromFile(path)`:

- ملف مفقود (`ENOENT`) -> يُرجع `[]`.
- الأسطر غير القابلة للتحليل يتعامل معها محلل JSONL المتساهل (`parseJsonlLenient`).
- إذا لم يكن أول إدخال مُحلل رأس جلسة صالحًا (`type !== "session"` أو `id` نصي مفقود) -> يُرجع `[]`.

سلوك `SessionManager.setSessionFile()`:

- `[]` من المُحمّل يُعامل كجلسة فارغة/غير موجودة ويُستبدل بملف جلسة جديد مُهيأ في ذلك المسار.
- الملفات الصالحة تُحمل، وتُرحّل إذا لزم الأمر، ثم تُحل مراجع الكائنات الكبيرة، ثم تُفهرس.

## دلالات الشجرة والورقة

النموذج الأساسي هو شجرة بالإلحاق فقط + مؤشر ورقة قابل للتغيير:

- كل طريقة إلحاق تُنشئ إدخالًا جديدًا واحدًا بالضبط يكون `parentId` فيه هو `leafId` الحالي.
- يصبح الإدخال الجديد `leafId` الجديد.
- `branch(entryId)` ينقل `leafId` فقط؛ الإدخالات الموجودة تبقى دون تغيير.
- `resetLeaf()` يضبط `leafId = null`؛ الإلحاق التالي يُنشئ إدخالًا جذريًا جديدًا (`parentId: null`).
- `branchWithSummary()` يضبط الورقة على هدف الفرع ويُلحق إدخال `branch_summary`.

`getEntries()` يُرجع جميع الإدخالات غير الرأسية بترتيب الإدراج. لا تُحذف الإدخالات الموجودة في العمليات العادية؛ إعادة الكتابة تحافظ على التاريخ المنطقي مع تحديث التمثيل (الترحيلات، النقل، مساعدات إعادة الكتابة المستهدفة).

## إعادة بناء السياق (`buildSessionContext`)

`buildSessionContext(entries, leafId, byId?)` يحدد ما يُرسل إلى النموذج.

الخوارزمية:

1. تحديد الورقة:
   - `leafId === null` -> إرجاع سياق فارغ.
   - `leafId` صريح -> استخدام ذلك الإدخال إذا وُجد.
   - وإلا الرجوع إلى آخر إدخال.
2. المشي عبر سلسلة `parentId` من الورقة إلى الجذر وعكسها للحصول على مسار جذر->ورقة.
3. اشتقاق حالة التشغيل عبر المسار:
   - `thinkingLevel` من أحدث `thinking_level_change` (الافتراضي `"off"`)
   - خريطة النماذج من إدخالات `model_change` (`role ?? "default"`)
   - `models.default` الاحتياطي من مزود/نموذج رسالة المساعد إذا لم يكن هناك تغيير نموذج صريح
   - `injectedTtsrRules` بدون تكرار من جميع إدخالات `ttsr_injection`
   - الوضع/بيانات الوضع من أحدث `mode_change` (الوضع الافتراضي `"none"`)
4. بناء قائمة الرسائل:
   - إدخالات `message` تمر كما هي
   - إدخالات `custom_message` تصبح رسائل `custom` من نوع AgentMessages عبر `createCustomMessage`
   - إدخالات `branch_summary` تصبح رسائل `branchSummary` من نوع AgentMessages عبر `createBranchSummaryMessage`
   - إذا وُجد `compaction` في المسار:
     - إصدار ملخص الضغط أولاً (`createCompactionSummaryMessage`)
     - إصدار إدخالات المسار بدءًا من `firstKeptEntryId` حتى حدود الضغط
     - إصدار الإدخالات بعد حدود الضغط

إدخالات `custom` و`session_init` لا تحقن سياق النموذج مباشرة.

## ضمانات الاستمرارية ونموذج الفشل

### الحفظ مقابل الذاكرة

- `SessionManager.create/open/continueRecent/forkFrom` -> وضع مستمر (`persist = true`).
- `SessionManager.inMemory` -> وضع غير مستمر (`persist = false`) مع `MemorySessionStorage`.

### خط أنابيب الكتابة

تُسلسل عمليات الكتابة من خلال سلسلة وعود داخلية (`#persistChain`) و`NdjsonFileWriter`.

- `append*` يُحدّث حالة الذاكرة فورًا.
- يُؤجل الحفظ حتى وجود رسالة مساعد واحدة على الأقل.
  - قبل أول مساعد: تُحتفظ الإدخالات في الذاكرة؛ لا يحدث إلحاق بالملف.
  - عند وجود أول مساعد: تُفرغ الجلسة الكاملة من الذاكرة إلى الملف.
  - بعد ذلك: الإدخالات الجديدة تُلحق تدريجيًا.

المبرر في الكود: تجنب حفظ الجلسات التي لم تُنتج أبدًا استجابة مساعد.

### عمليات المتانة

- `flush()` يُفرغ الكاتب ويستدعي `fsync()`.
- إعادة الكتابة الذرية الكاملة (`#rewriteFile`) تكتب في ملف مؤقت، تُفرغ+تزامن، تُغلق، ثم تُعيد تسمية فوق الهدف.
- تُستخدم للترحيلات، `setSessionName`، `rewriteEntries`، عمليات النقل، وإعادة كتابة وسائط استدعاء الأدوات.

### سلوك الخطأ

- أخطاء الاستمرارية تُسجل (`#persistError`) وتُعاد طرحها في العمليات اللاحقة.
- يُسجل الخطأ الأول مرة واحدة مع سياق ملف الجلسة.
- إغلاق الكاتب يتم بأفضل جهد لكنه ينشر أول خطأ ذي معنى.

## ضوابط حجم البيانات وتخزين الكائنات الكبيرة خارجيًا

قبل حفظ الإدخالات:

- تُقتطع السلاسل الكبيرة إلى `MAX_PERSIST_CHARS` (500,000 حرف) مع إشعار:
  - `"[Session persistence truncated large content]"`
- تُزال الحقول المؤقتة `partialJson` و`jsonlEvents`.
- إذا كان الكائن يحتوي على كل من `content` و`lineCount`، يُعاد حساب عدد الأسطر بعد الاقتطاع.
- كتل الصور في مصفوفات `content` مع طول base64 >= 1024 تُخزّن خارجيًا كمراجع كائنات كبيرة:
  - تُخزن كـ `blob:sha256:<hash>`
  - تُكتب البايتات الخام في مخزن الكائنات الكبيرة (`BlobStore.put`)

عند التحميل، تُحل مراجع الكائنات الكبيرة مرة أخرى إلى base64 لكتل صور message/custom_message.

## تجريدات التخزين

واجهة `SessionStorage` توفر جميع عمليات نظام الملفات المستخدمة بواسطة `SessionManager`:

- متزامنة: `ensureDirSync`، `existsSync`، `writeTextSync`، `statSync`، `listFilesSync`
- غير متزامنة: `exists`، `readText`، `readTextPrefix`، `writeText`، `rename`، `unlink`، `openWriter`

التنفيذات:

- `FileSessionStorage`: نظام ملفات حقيقي (Bun + node fs)
- `MemorySessionStorage`: تنفيذ في الذاكرة مدعوم بخريطة للاختبارات/الجلسات غير المستمرة

`SessionStorageWriter` يكشف `writeLine`، `flush`، `fsync`، `close`، `getError`.

## أدوات اكتشاف الجلسات

مُعرّفة في `session-manager.ts`:

- `getRecentSessions(sessionDir, limit)` -> بيانات وصفية خفيفة لواجهة المستخدم/منتقي الجلسات
- `findMostRecentSession(sessionDir)` -> الأحدث حسب وقت التعديل
- `list(cwd, sessionDir?)` -> الجلسات في نطاق مشروع واحد
- `listAll()` -> الجلسات عبر جميع نطاقات المشاريع تحت `~/.xcsh/agent/sessions`

استخراج البيانات الوصفية يقرأ بادئة فقط (`readTextPrefix(..., 4096)`) عند الإمكان.

## ذو صلة لكن مختلف: تخزين سجل الأوامر

`HistoryStorage` (`history-storage.ts`) هو نظام فرعي SQLite منفصل لاسترجاع/بحث الأوامر، وليس لإعادة تشغيل الجلسات.

- قاعدة البيانات: `~/.xcsh/agent/history.db`
- الجدول: `history(id, prompt, created_at, cwd)`
- فهرس FTS5: `history_fts` مع مزامنة مُدارة بالمشغلات
- إزالة التكرار للأوامر المتتالية المتطابقة باستخدام ذاكرة مؤقتة لآخر أمر في الذاكرة
- إدراج غير متزامن (`setImmediate`) حتى لا يعيق التقاط الأوامر تنفيذ الدور

استخدم ملفات الجلسات لرسم بياني المحادثة/إعادة تشغيل الحالة؛ واستخدم `HistoryStorage` لتجربة مستخدم سجل الأوامر.

# مراجعة ما قبل الإصدار — BP MD RTL Reader

> **الحالة الحالية (2026-09-24): كل بنود هذه البوابة وملاحقها مغلقة.** النتيجة أدناه هي الحكم التاريخي للبوابة يوم 2026-09-22؛ ملحقا التنفيذ أسفل الوثيقة (الهجوم العدائي الثاني 2026-09-24 + جولات المتبقي) يوثّقان إغلاق كل بند بالالتزامات a48bb88 → 73391d3 والبوابات الخضراء. المتبقي قرار المالك فقط: sign + tag + push.
>
> **ملاحظة تحريرية (2026-09-27):** كانت الشجرة المُراجَعة تحمل الاسم المبدئي `1.3.1` في `package.json` وقت المراجعة؛ سُحب هذا الاسم قبل الإصدار ويَصِل هذا العمل كلّه باسم **v1.3.0** (انظر ملاحظة الدمج في أول CHANGELOG.md). ذكر 1.3.1 أدناه تسجيلٌ تاريخي لا اسم إصدارٍ صادر.

**النتيجة النهائية: 🚫 NO-GO — لا تقطع الإصدار قبل إصلاح الثغرة الحرجّة (F1) وثغرتَي RTL المُعيقتين للمنتج (RTL-H1/H2).**

نطاق المراجعة: العملية الرئيسية والجسر (`src/main`, `src/preload`)، خط أنابيب العرض والتعقيم (`src/renderer/markdown`, `app.js` sinks)، سلامة البيانات (المخازن، الحفظ، الاسترداد، التعارض)، صحة ثنائي الاتجاه (bidi/RTL)، وجاهزية الإصدار (build/version/docs/dist). خمسة فرق مراجعة مستقلة + مراجعة نقدية مباشرة + تشغيل بوابات المشروع.

---

## 1. نتائج البوابات الرسمية

| البوابة | النتيجة |
|---|---|
| `npm run test:unit` | ✅ أخضر — 107 ملفات / **1935 اختباراً** |
| `npm run lint:security` | ✅ نظيف — 207 ملاحظات مراجَعة، 0 جديدة/مُنزاحة |
| `node scripts/release-preflight.js` | ❌ **يفشل** (exit 1) — راجع BL1 و R-H1 |
| `node scripts/verify-package-contents.js` | ✅ 3 asars سليمة، 24/24 ملفاً وقتياً |
| `node scripts/verify-electron-fuses.js` | ⚠️ ينجح لكن يتحقق من 6 من 7 fuses — راجع R-F3 |
| `npm run vendor:check` | ⚠️ تعذّر تشغيله (بيئة sandbox: `spawn EPERM`) — تحقّق ثابت: 27/27 hash مطابق |
| `node scripts/dependency-license-inventory.js --check` | ✅ 854 entries |

**مفارقة جوهرية:** الاختبارات خضراء بالكامل مع وجود CRITICAL يفسد الملفات — لأن الاختبارات تثبّت شكل DOM/الحالة لا السلوك المُصَيَّر ولا تبديل الأدوار بين ملفين. هذه فجوة تغطية يجب سدها مع كل إصلاح أدناه.

---

## 2. حرجّة (Critical) — 1

### F1 — كتابة في الملف الخطأ / تلف متبادل بعد أي دمج مجلدات (معاملة سلامة البيانات)
- **الموقع:** `src/renderer/components/workspace-controller.js:80` (`mergeVaultSlice` تعيد بناء المصفوفة دائماً كـ `[...otherVaultFiles, ...merged, ...keptAbsent]`) + `app.js:3530-3535` (`applyEditorInput` يستهدف `State.files[State.activeFile]`) + `workspace-controller.js:266-277, 836-858`.
- **السيناريو:** مجلدان A وB مفتوحان، المستخدم يعدّل مذكرة في B (`activeFile = k`) → أي حدث `fs.watch` عن A (حتى من حفظ التطبيق نفسه التلقائي) → `mergeVaultSlice(A)` ينقل ملفات B إلى فهارس جديدة → `activeFile` k يشير الآن لملف A → أول ضغطة مفاتيح تكتب **نص B كاملاً** في مخزن ملف A وتضعه dirty → الـ autosave يكتب نص B فوق ملف A على القرص. تلف صامت لملفَي مستخدم، وتعديلات B ضائعة.
- **المحفّزات شائعة:** حفظ تلقائي، إعادة فتح مجلد عبر Open Folder (`openVault` لا يعيد الحل إطلاقاً)، حتى ملف يختفي لنظرة واحدة (`keptAbsent`).
- **الإصلاح:** بعد كل عملية إعادة ترتيب/حذف في `state.files`، أعد حل `state.activeFile` بالهوية (`fileKey`/`vaultId+path`) وليس الفهرس — أو اجعل `mergeVaultSlice` تحافظ على مواضع العناصر القائمة وتضيف الجديد فقط. أضف اختباراً يثبّت «تعديل أثناء دمج مجلد آخر يكتب في الملف الصحيح».

---

## 3. عالية (High) — 10

### سلامة البيانات
**F2 — تعارض «شبح» دائم لملفات UTF-16/Windows-1256 + فخ فقدان بيانات.**
- `document-store.js:207` (القراءة: hash على `utf8Key` = البايتات كـ UTF-8) مقابل `:244` (الكتابة: hash على النص النظيف) + `:224-227` و`ipc-controller.js:533-535`.
- كل حفظ بعد الأول في ملف غير UTF-8 يرجع `{error:'conflict'}` لملف لم يمسّه أحد → لافتة «تغيّر على القرص» كاذبة → زر **Reload from disk** يرمي تعديلات المستخدم الحقيقية (فقدان بيانات). و_tick الـ watcher بين الحفظات يفعل ذلك أيضاً لملف dirty عبر `mergeVaultSlice:57-67`.
- **الإصلاح:** اجعل `write().meta.hash` يحسب تماماً ما تحسبه القراءة التالية (`hashContent(writtenBytes.toString('utf8'))` — يُبقي توافق UTF-8 التاريخي) + اختبار round-trip للترميزات الأربعة. *(وُجدت مستقلاً بثلاثة مراجعين.)*

**F3 — التعليقات ومواضع القراءة تتيمّن نهائياً بسبب تدوير معرّفات القدرات.**
- `session.js:53-61` (`fileKey` = `doc:<capabilityId>`) + `ipc-controller.js:895-932` (`prune()` عند كل إقلاع) + `capabilities.js:100-119, 147-163`.
- ملاحظة خرجت من أحدث 5 recents أو مجلد أُغلقت كل تبويباته يُحذف سجل قدرتها → إعادة الفتح تمنح `cap-B` جديد → كل التظليلات وتعليقات الهامش ومواضع القراءة تحت `doc:cap-A` تصبح **غير قابلة للوصول إلى الأبد**.
- **الإصلاح:** اربط البيانات بهوية مستقرة (المسار canonical يحله main في `annotations:*`) أو استبعد الوثائق المُشار إليها من `prune()` + ترحيل المفاتيح القديمة.

### أمان الحدود المميزة (الضمانات المعلنة للنموذج قابلة للتجاوز)
**S-H1 — `fs:writeFile` قد يتجاوز كشف التعارض (SEC-02 bypass).**
- `ipc-controller.js:531-536` + `document-store.js:224-227`: إذا لم يكن لدى main سجل hash (وثائق lastSession غير المقروءة، `fs:reopenDocument` بلا قراءة، منحُ readVault الفاشلة) ويُحذف `baseHash` → **تخطي فحص التعارض كلياً** → تلف صامت. مثال SEC-02 نفسه.
- **الإصلاح:** اطلب baseline جلسة إلزامي؛ عند غيابه اقرأ fresh وقارن، وإلا `conflict`.

**S-H2 — هروب symlink في مسار قراءة الوثائق + إعادة تثبيت عبر reopen (فجوة JB4).**
- `ipc-controller.js:195-222` (`statSync`/`docStore.read` يعبران الرابط الرمزي بلا `isSymlinkEscape` ولا إعادة فحص امتداد الهدف) و`475-509` (`fs:reopenVault/Document` يعيدان تثبيت `record.path = realpath(...)` و**يحفظانه** بلا احتواء — تناقض مع `bootstrapSessionGrants:922`).
- كتابة داخل مجلد ممنوح (repo خبيث/أرشيف) تستبدل `note.md` بـ symlink إلى `../../.ssh/id_rsa` → `fs:readFile` يُعيد محتوى أي ملف ≤10MB، و`reopenDocument` يثبّت الصلاحية على الهدف الخارجي للأبد، وملف `.md` خارج الجذر يصبح قابلاً للكتابة.
- **ال怊ich:** عند كل استخدام: `realpath` + `isInside(real, grantRoot)` + فحص `.md` على الهدف الحقيقي؛ ارفض إعادة التثبيت عند تغيّر الجذر («moved → picker»).

### ثنائي الاتجاه (ميزة المنتج الرئيسية)
**RTL-H1 — `<bdi>` العارية لا تحمي المجموعات الرقمية المحايدة.**
- `bidi.js:90-92` + `bidi-dom.js:119-136`: `<bdi>` بلا `dir` = `dir="auto"`؛ نص بلا حرف قوي يرث اتجاه الأب (RTL) فتنقلب الأرقام **داخل** العزل: `2026-06-01`→`01-06-2026`، `12:30`→`30:12`، `3.14`→`14.3`.
- اختبارات DOM تثبّت الشكل فقط (`bidi-dom.test.js:159-171`) فلا تكشفه.
- **ال怊ich:** `<bdi dir="ltr">` لبدائل المجموعات الرقمية في `RUN` (و`<bdi>` عادي لـ `#tags`) + تأكيد Playwright على الترتيب المُصَيَّر.

**RTL-H2 — روابط نصها أرقام فقط لا تُعزل إطلاقاً (ويكي-روابط المذكرات اليومية تنقلب).**
- `bidi-dom.js:29, 91-101`: `needsIsolation` ترجع false للمحايد، و`SKIP_PARENT` يمنع دخول `<a>`. `[[2026-06-01]]` تُصيَّر `01-06-2026` داخل نص عربي.
- **ال怊ich:** أزل `A` من `SKIP_PARENT` أو اعزل روابط النص المحايد بـ `<bdi dir="ltr">`.

**RTL-H3 — كتل الكود في التصدير/EPUB غير مفروضة LTR.**
- `export.js:157` و`epub.js:43`: قاعدة التطبيق `pre{direction:ltr}` (components.css:1340) غائبة عن صفحتَي التصدير → الكود ينعكس ويتداخل (أقواس معكوسة) في HTML/PDF/EPUB لمستند RTL.
- **ال怊ich:** أضف `pre { direction: ltr; text-align: start; }` (+`code{direction:ltr;unicode-bidi:isolate}`) لكلا الأسلوبين.

**RTL-H4 — اتجاه front-matter/الإجباري يسرّب على ودجات CM6 + ركود عند التبديل.**
- `app.js:3635/3661` تهمل `fmDir` (مقابل `applyBidiToNote:245`) + `block-preview.js:46/100` (`eq()` يعيد DOM قديماً، الحساب فقط على doc/selection). جدول مذكرة `direction: rtl` يظهر معكوساً في التحرير وغير معكوس في القراءة، وCtrl+Shift+L لا يحدّث الودجات المعروضة.
- **ال怊ich:** احسب `State.forcedDir || frontMatterDirection(...)` في `renderCmBlock`، وادمج قيمة الاتجاه في هوية الودجة (`eq` يقارن `dirKey`).

---

## 4. متوسطة (Medium) — 26

### سلامة البيانات (6)
- **F4 — مانع إغلاق 20 ثانية يقتل الجلسات أثناء رد المستخدم** (`window-controller.js:78, 283-292`) — نافذة حفظ بطيئة (>20 ث) تُغلق قسراً؛ `abortWindowClose` لا يُرسل إلا قبل Save As/إلغاء. أرسله عند فتح `askSaveChanges`.
- **F5 — لقطة الاسترداد تُحذف قبل قرار المستخدم** (`ipc-controller.js:843` + `app.js:5018-5041`) — Escape/الخلفية = «رمِ» صامت للعمل غير المحفوظ. اجعل `pop` نسخاً، والحذف بعد Restore/Discard صريح فقط.
- **F6 — «Keep my edits» يدمر نسخة القرص بلا نسخة احتياطية + `diskMeta` الصفراء تُدخل حفظاً ميتاً** (`app.js:2548-2561` + `workspace-controller.js:437-449`). احفظ النساحة المزاحة في ملف `.conflict-<ts>.md`، وارفض مسح اللافتة بلا baseline.
- **F7 — إعادة الترميز خاسرة/UTF-16 بلا BOM يُفكَّك خطأً** (`document-store.js:66-78, 103-114`) — رموز غير قابلة للتمثيل تتحول `?` بصمت؛ ملف UTF-16 بلا BOM يُفسَّر cp1256 ثم يُكتب فاسداً. خطأ مكتوب عند عدم إمكان التمثيل + كشف UTF-16 بكثافة البايتات الصفرية.
- **F8 — فشل Save-All عند الإغلاق يصمت** (`workspace-controller.js:602-620`) — المستخدم يختار «Close without saving» ظناً أن لا شيء معلّق. اعرض اللافتة/toast لكل فرع فشل.
- **F9 — التقاط موضع القراءة لا يُلغى عند `showWelcome`** (`app.js:2643-2692, 2341-2363`) — المؤخر يقيس بطاقة الترحيب ويكتب نسبة قمامة في رفّ مذكرة (بقية صنف BUG-1). ألغِ/علّق داخل `showWelcome`.

### أمان (6) — `ipc-controller.js` ما لم يُذكر
- **S-M1 — `documentGrantActive` يتجاوز مسار المنح الجلسي** (`:169-173`) — أخطاء `unauthorized-capability` زائفة لملفات بأصحاب vault خامل، و`reopenDocument` يرجع `ok:true` والوثيقة لا تزال مرفوضة؛ وتفعيل vault يفعّل كل وثائقه صامتاً. الدمج: `vaultGrantActive(vaultId) || sessionDocumentGrants.has(id)`.
- **S-M2 — تعارض hash** = F2 أعلاه (مطابق).
- **S-M3 — فلتر `file:` في تصدير PDF يسمح بتسريب ملفات محلية إلى PDF** (`:634-639`) — `<img src="file:///...">` في الـ HTML المُصدَّر تُطبع في PDF. اسمح فقط بـ `tmpHtml` و`data:`.
- **S-M4 — غسيل SEC-01 عبر reopen بلا إيماءة مستخدم** (`:475-509`) — أي كود renderer يحوّل المنح المحفوظة إلى صلاحية حية ويقذف حتى 5000 ملف/100MB. اربط reopen بإيماءة أو اقبل وضعفه كتابةً.
- **S-M5 — `prune()` يحذف وثائق مرجعية** (`capabilities.js:156-160`) — `keepDocumentIds` يُتجاهل للوثيقة ذات `vaultId` غير محفوظ؛ و`lastSession.openPaths` لا تدخل مجموعات الحفظ. (`=سبب F3`).
- **S-M6 — ملف مؤقت متوقع بلا `O_EXCL`** (`document-store.js:177-185`) — `Math.random` + `writeFileSync` يتبع symlink → كتابة عبر الرابط. طبّق نمط SEC-04 (`randomUUID` + `'wx'`). *(وُجدت مستقلاً بمراجعة مباشرة.)*

### ثنائي الاتجاه (8)
- **RTL-M1** — اتجاه الجدول يعدّ حروف الكود (`bidi-dom.js:77` تفوت استثناء UX-02) — جدول عربي بخلايا كود يصير `dir="ltr"` غير معكوس. استخدم `blockText(t)`.
- **RTL-M2** — AUTO يصفّر `State.direction='ltr'` لمحتوى عربي (`app.js:275-280`) — مؤشر خاطئ + baseDir خاطئ للودجات. اضبط `docDir`.
- **RTL-M3** — Find في وضع التحرير بلا تطبيع عربي (`codemirror-adapter.js:170-181`) — `محمد` لا يجد `مُحَمَّد` في التحرير وتجده في القراءة.
- **RTL-M4** — `navWikilink` بلا `normalizeArabic` + `[[foo.md]]` لا تطابق أبداً (`app.js:3470-3485`).
- **RTL-M5** — `vaultSearch` يفيض بكل الملفات على استعلامات التشكيل المجردة (`search.js:38-60` — `includes('')` دائماً true). حارس `!normQuery`.
- **RTL-M6** — اتجاه سطر المحرر يعدّ حروف الكود المضمنة (`line-direction.js:35`) — تعارض مع المعاينة.
- **RTL-M7** — قصّ الروابط يفوت النطاقات بلا مخطط والإيميلات (`bidi.js:56`) — `docs.example.com/en/...` يقلب فقرة عربية.
- **RTL-M8** — التصدير بلا ids للعناوين ولا تطبيع fragments (`export.js:106-110`) — روابط `#عنوان` ميتة في المُصدَّر.

### جاهزية الإصدار (12) — `docs/` و`scripts/` و`CHANGELOG.md`
- **R-F3** — Fuse `enableCookieEncryption` مُهيّأ (`package.json:91`) وغير مُتحقَّق (`verify-electron-fuses.js:8-15` — 6 من 7) — ينقض ادعاء CHANGELOG:181. أضفه لـ `REQUIRED`.
- **R-F4** — CHANGELOG:14 تدّعي وصول Oasis «من Settings dialog» — لا يوجد منتقي ثيمات هناك. احذف العبارة.
- **R-F5** — «Each note» للمواضع مبالغة (`reading-progress.js:37-57` — لوثائق `cap-*` فقط) + أضف الحد لـ «Documented limits (v1)».
- **R-F6** — تصدير HTML/PDF يلحق صامتاً ملحق «Notes» بالتعليقات (`export.js:47-79,123-141`) — خصوصية عند المشاركة؛ EPUB لا يفعل. وثّقه.
- **R-F7** — CHANGELOG:40-42: بندان من «Fixed» معلّقان تحت «### Added — installer (T12)» — أضف عنوان `### Fixed — reading experience`.
- **R-F8** — `LICENSE-AUDIT.md` قديم (2026-07-23، إصدارات 1.0.1/3.4.12/11.15.0) وبلا EnVar.
- **R-F9** — ~~`resources/vendor/fonts/*.woff2` و`build/x86-unicode/EnVar.dll` خارج شبكة نسب (`vendor:check`/`vendor-provenance.test.js`) — hash EnVar نصي فقط.~~ **مُغلق 2026-09-24:** كلاهما مثبّت بالهاش في `vendor-manifest.json` عبر `sync-vendor.js`، و`vendor-provenance.test.js` يعيد حساب SHA-256 لكل ملف.
- **R-F10** — `dist/SHA256SUMS.txt` قديم (أسماء 1.0.0) — لا ترفقه بالإصدار؛ ولّد عبر `npm run package:checksums` في `dist/release/` نظيف.
- **R-F11** — مجموعة artifacts لـ 1.3.0 ناقصة (لا Inno/source-manifest، لا macOS/Linux) + مخلفات 1.2.0 في `dist/` — تحقق من صفحة الإصدار فعلياً.
- **R-F12/F13/F14** — بوابة mutation للمثبّت لا تُفرض أبداً (`-SkipMutation`)؛ عتبات تغطية renderer سكربتات لا config؛ اختبار إلغاء التثبيت على جهاز حقيقي يُتخطى إلا يدوياً (مهم بسبب وعد إزالة PATH في T12).

### تعقيم renderer (1)
- **X-F1 — سياسة Trusted Types الافتراضية أضعف من `sanitizeHtml`** (`trusted-types-policy.js:21-25` تُبقي `<style>` و`style=""` بلا `ALLOWED_URI_REGEXP`) + `openModal` (`app.js:745`) يستخدم `DOMPurify.sanitize` الخام؛ وCSS مؤلف مُوجَّه يصل عبر Mermaid `classDef`→`<style>` في SVG (`trusted.js:32-39`) — محجوب بالـ CSP لكنه حقن CSS/تلوين UI. وحّد السياسة مع `sanitizeHtml` ومرّر `openModal` عبره.

---

## 5. منخفضة (Low) — ~47 (مكثّف)

- **أمان (12):** وصفة تدوير pin خاطئة (SPKI مقابل fingerprint256 — `github-tls.js:13-14,58-61`) · لا rate-limit سوى `log:error` · TOCTOU بقايا · `detectEol` مكلفة على 10MB · `settings:set` يسمح بتفعيل الشبكة · `defaultPath` تحكمه renderer · `contextMenuStash` يتراكم · `rel.startsWith('..')` يرفض `..data.md` · سجلات vault غير مقيّدة في `capabilities.json` · `openExternal` بلا إيماءة (قناة تسريب صامتة) · ترميز الكتابة اختيار renderer · سباق `readGenerations` يترك vault بلا watcher.
- **سلامة بيانات (8):** حارس docKey في Highlight خارج فرع `mode==='note'` فقط (`app.js:3017` — التظليل العادي يزال يُسجَّل في الوثيقة الخطأ) · استرداد بلا هوية + حذف صامت فوق السقف (`app.js:4999`) · مخازن JSON تُعيد تسمية بلا fsync (`json-store.js:20-29`) · rollback إحصاءات القراءة يخسر أيامًا مقصوصة · recents تُزاح بالمسار فقط (تصادم بين مجلدين) · إغلاق مجلد واحد يعرض عدد dirty العام · `flushSettings` يصمت أثناء الاستعادة · TOCTOU بين فحص التعارض و`renameSync`.
- **RTL (5):** `slugify` يُبقي علامات قرآنية وقد ينتج id فارغاً (`bidi.js:121`) · `hasTashkeel` ي误 يجيز الأرقام العربية (`i18n.js:39`) · طيّ البحث يفوت ؤ/ئ والأرقام (`text-normalize.js:13`) · تسريب CSS فيزيائي واحد (`components.css:2279`) · regex `#tag` يبتلع شرطة سالبة.
- **XSS (9):** رياضيات فوق 32KiB تتجاوز ترميز marked (`math.js:38-44`) · اصطدام placeholders U+E000 (`math.js:18-20`) · wikilink `data-target` بقصّ اقتباسات (`markdown.js:30`) · `escapeHtml` لا يهرب `'` · 3 تداخلات `tl()` غير مهربة · معقمات default identity (fail-open) · DOM clobbering عبر id/name · `data:image/svg+xml` في `href` · EPUB لا يزيل محارف XML غير صالحة.
- **إصدار (~22):** CHANGELOG «no new dependency» مقابل EnVar · KEYBOARD_SHORTCUTS ينقصه `Ctrl+E` كلياً و`Ctrl+Shift+Z` غير مربوط و«scoped to the editor» قديم · T12/T13 غير موثقة للمستخدم وPRIVACY يصمت عن كتابة PATH · «Try Demo Notes» مقابل زر «Try Demo» · README «CI gated» مقابل «Actions معطّل» · «persist with your library» مقابل `annotations.json` · قائمة إعدادات PRIVACY ناقصة · نص «30 ثانية» مقابل 15 ث · تناقض CHANGELOG:181/185 · لقطات README 3 من 4 ثيمات · `claude.yml` بلا timeout · إلخ.

---

## 6. المناطق الموثّقة سليمة (مُتحقَّق منها ميدانياً)

- **احتواء البروتوكولات** `app://`/`bpmd://` — كشف المخطط قبل decode، احتواء realpath مزدوج، صور فقط عبر bpmd، حقن encoding/dot-segment ينهار.
- **قناة التحديث** — URL ثابت، بلا معلمات renderer، TLS pin fail-closed، بلا redirect، بلا تحميل تلقائي.
- **الـ preload** — contextBridge فقط، بلا مسارات، كل قناة لها handler.
- **تعقيم Markdown الأساسي** — DOMPurify 3.4.13 (بلا mXSS معروفة)، KaTeX `trust:false` مفروض حتى مع overrides، Mermaid `securityLevel:'strict'`+`htmlLabels:false`، كل مسارات `innerHTML` مُحصاة (نحو 60 موقعاً) — لا XSS حرج/عالي.
- **الكتابة الذرّية للوثائق** — fsync ثم rename، أخطاء مكتوبة ENOSPC/ENOENT، لا ملفات `.md` ممزقة.
- **نموذج UTF-8 hash/التعارض** متسق ذاتياً (سواه يكسره F2 فقط)؛ `migrate()` v5 يغطي مفاتيح الـ 26 كلها؛ حدود `readVault` (5000 ملف/عمق 12/100MB) صحيحة؛ حارس `revision` في الحفظ سليم؛ بروتوكول إغلاق التبويب ثلاثي الاختيارات سليم؛ إصلاح BUG-1 الأساسي (تبديل تبويب↔تبويب) يصمد.
- **نواة bidi النقية** — `resolveBlockDirection` (أغلبية صارمة، إزالة النطاقات، tie→inherit) و`slugify` المطوي والموازنة بين TOC والعناوين و`nextCellIndex` وترتيب أولويات `resolveDocDirection` — كلها سليمة ومخترَضة بسيناريوهات مضادة.
- **CSS** — اصطلاح الخصائص المنطقية مُحترم (استثناء `#editor[dir="rtl"] text-align` الموثّق فقط، + تسريب تجميلي واحد).
- **الأتمتة** — كل `uses:` مثبّت بـ SHA كامل في 4 workflows، صلاحيات أدنى مستوى، مُفروضة باختبار.

---

## 7. خطة الإصلاح حسب الأولوية

**قبل أي بناء إصدار (Blockers):**
1. **F1** — هوية النشط بدل الفهرس (أو merge بمواضع ثابتة) + اختبار.
2. **RTL-H1 + RTL-H2** — `<bdi dir="ltr">` للأرقام + عزل روابط محايدة (+ تأكيد ترتيب مُصَيَّر واحد على الأقل).
3. **F2** — توحيد أساس hash القراءة/الكتابة + اختبار round-trip.
4. **S-H1 + S-H2** — إغلاقا SEC-02/JB4 (ضمانات النموذج المعلنة نفسها).
5. **F3 / S-M5** — هوية مستقرة للتعليقات/المواضع + إصلاح `prune()`.
6. **RTL-H3 + RTL-H4** — `pre{direction:ltr}` في التصديرات + اتجاه ودجات CM6.
7. **BL1** — تحديث `.secreports` (syft/OSV/grype/gitleaks) ليعبر preflight؛ **R-H1** — إصلاح env في preflight؛ **R-H2 + R-F4/F5/F6/F7** — إصلاحات الوثائق/CHANGELOG قبل إعادة تسميته.

**قريبة (قبل الإصدار بقليل أو فوراً بعده):** S-M1/M3/M4/M6، F4–F9، X-F1، RTL-M1–M8، R-F3/F8/F9/F10/F11.

**متابعة موثّقة:** كل الـ Low + إضافة اختبارات Playwright للترتيب المُصَيَّر واختبار «ملفَان + مجلدَان» للحفظ، لأن الاختبارات الحالية صمّاء عن CRITICAL كهذا.

---

*مراجعة قوية قبل الإصدار — جُمعت من: أمان الحدود المميزة، تعقيم renderer، سلامة البيانات، دقة RTL، جاهزية الإصدار، ومراجعة نقدية مباشرة — مع تشغيل بوابات المشروع.*

---

# الهجوم العدائي الثاني — 2026-09-24 (قبل توقيع 1.3.1)

**النتيجة: 🚫 NO-GO قبل الإصلاح → ✅ كافة الإصلاحات البرمجية نفّذت والبوابات خضراء.**
هجوم red-team ثانٍ (3 وكلاء استكشاف متوازون + تحقق مباشر) بعد إصلاحات 5baaa28/f7cc08f. صفر P0؛ الهيكل الأمني الصلب (XSS/IPC/بروتوكولات/supply chain) صمد بالكامل — الثغرات الجديدة كلها في سلامة البيانات مجدداً.

## P1 (3) — أُصلحت كلها ✅

| # | الثغرة | الموقع | الحالة |
|---|---|---|---|
| 1 | Save As لا يفعّل session grant → كل حفظ بعده `unauthorized-capability` (وautosave يتوقف بصمت) | `ipc-controller.js:606` | ✅ `sessionDocumentGrants.add` + اختبار |
| 2 | نتائج البحث/palette/بانر التعارض تمسك فهرساً قديماً بعد أي دمج → فتح و**كتابة autosave في ملف آخر** | `app.js:2074/4727/2574`, `workspace-controller.js:977` | ✅ عنونة بـ `fileKey` + `resolveActiveAfterMerge` في restoreLastSession + اختبار mutation-verified |
| 3 | ثقة عمياء بـ UTF-8 BOM: ملف cp1256 نصف محوّل يُقرأ U+FFFD ثم autosave يمسح الأصل بلا حوار | `document-store.js:122` | ✅ `isValidUtf8` على الجسم؛ فشل → فرع cp1256 + 3 اختبارات |

## P2 (4) — أُصلحت كلها ✅
تظليل عبر الملفات أثناء التبديل (`app.js:2896` — إعادة توجيه تزامنية + دمج أثناء التحميل) • تجاوز سقف الرياضيات بحرفي U+E000/E001 حرفيين (`math.js` — سقف على جانب الاستعادة) • تعارض ذاتي عند تزامن حفظين (قفل save-in-flight لكل ملف) • Inno pin غير مربوط بـ package.json (`installer-security.test.ps1:51` — ربط مباشر).

## P3 (11) — أُصلح المختار (4)، البقية اختيارية موثقة
✅ json-store/settings: UUID+O_EXCL+unlink للـ temp • ✅ postinstall بلا `npx` fallback • ✅ تراجع `meta.encoding` عند إلغاء Save-As • ✅ baseline إعادة تثبيتها (نفس 213 ملاحظة — انزياح أسطر فقط، تحقق يدوي). ⬜ المتبقي: closeVault بلا فحص grant، flush قراءة vault لملفات persistGrant:false، سقف argv التراكمي، بانر تعارض index قديم (خففه إصلاح الهوية)، ابتلاع المودال المشترك لحوار سابق، failsafe الإغلاق فوق حوار encoding، دمج pushRecent بالمسار فقط.

## البوابات بعد الإصلاح (2026-09-24)
`npm test` = unit **108/1980** ✅ + e2e **844/844** ✅ + electron **23/23** ✅ • `lint:security` ✅ (213 reviewed, 0 new) • Pester installer **34/34** ✅.

## ما زال مفتوحاً من هذه البوابة السابقة (قرار المالك)
RTL-H1/RTL-H2 (blockers منتجية)، UTF-16 بلا BOM، `recovery:pop` يحذف قبل القرار، بقايا dist قديمة — كلها موثقة أعلاه ولم تُطالب إصلاحات هذا الهجوم بها.

*تحليل استاتيكي فقط — التطبيق لم يُشغَّل يدوياً؛ التغطية عبر الأجنحة المذكورة.*

---

# ملحق التنفيذ الثالث — 2026-09-24 (جولة المتبقي): كل البنود أُغلقت ✅

بعد التزامي a48bb88 (الجولة الثانية) وeebe6e6 (هذه الوثيقة)، نُفّذ المتبقي كاملاً بأمر المالك:

**الثغرات P3 السبع — كلها أُصلحت ✅**
1. `fs:closeVault` يشترط grant نشطًا (`vaultGrantActive`) — اختبار main-side.
2. سجلات `persistGrant:false` صارت `sessionOnly` ولا تُسلسل أبداً حتى مع flush لاحق (والـ flush من readVault أُسقط) — اختبار ترقية/عدم-ترقية.
3. سقفان (5000 ملف / 100MB تراكمي) في `parseFileArgs` يغطيان argv/Open-With/second-instance — 4 اختبارات (كانت الدالة بلا تغطية أصلاً).
4. بانر التعارض: أُصلح فعلاً في a48bb88 بالعنونة بالهوية (`bannerKey`) — تحقق، لا عمل جديد.
5. المودال المشترك: أي حوار يُستبدل يُسوّى فوراً بقيمته المهجورة (`pendingModalSettlers`) + الاختصارات العامة معطلة أثناء مودال مفتوح — e2e بفحص طفرة.
6. failsafe الإغلاق يُجهض الآن عند أي اختيار Save (يغطي حوار الترميز، لا Save-As فقط).
7. `pushRecent` يدمج بزوج (path, vaultId) نفسه الذي يفتح به `openRecent` — اختبار.

**RTL-H1 + RTL-H2 ( blockers بوابة 2026-09-22) — أُصلحتا ✅**
- RTL-H1: مجموعات الأرقام والكود السطري تُعزل بـ `<bdi dir="ltr">` صريح (`isolate()` أصبحت تقبل dir)؛ `#tags` تبقى auto — 6 اختبارات وحدية + 3 e2e منها تأكيد الترتيب المُصَيَّر بالهندسة (Range/getBoundingClientRect) وفحص طفرة على كلا الإصلاحين.
- RTL-H2: فُتحت الروابط للعزل السطري (أُزيلت A من SKIP_PARENT) مع حماية مطلقة لروابط URL من التفتيت (رفض `://`) + منع إعادة عزل ما هو داخل bdi — اختبارات وحدية وe2e (wikilink تاريخ).
- تحديث وحيد لاختبار قائم: توقيع التصدير أصبح `<bdi dir="ltr">42</bdi>`.

**البوابات بعد الجولة (2026-09-24/جولة 3):** unit **108/1993** ✅ + e2e **848/848** ✅ + electron **23/23** ✅ + `lint:security` ✅ (نفس 213، بصمة معاد تثبيتها 7f1a5d59) + Pester **34/34** ✅.

**المتبقي المفتوح الآن (قرار المالك فقط):** UTF-16 بلا BOM، `recovery:pop` يحذف قبل القرار، بقايا dist القديمة، وRTL-H3/H4 (تصدير الكود LTR + ودجات CM6) — غير معطِّلة. **dist يجب إعادة بنائها** (كل البناء يسبق a48bb88 وهذه الجولة). sign/tag/push = المالك.

---

# ملحق التنفيذ الرابع — 2026-09-24 (البنود المتبقية + إعادة بناء dist)

بأمر المالك («قم بها… افعل ما تراها مناسبا»») أُغلقت كل البنود المفتوحة المتبقية:

**1. UTF-16 بلا BOM (بقايا F7) ✅** — كشف بتعادل البايتات (`isUtf16Parity`: بايت علوي ≤0x08 في كل زوج — يغطي ASCII/Latin/العربية؛ CJK خارج النطاق وموثّق) قبل فرعي UTF-8/cp1256؛ قراءة سليمة + round-trip بايت-بالبايت بلا تعارض كاذب (5 اختبارات، فحص طفرة). البدائل الفردية odd-length تُترك للفروع القائمة (لا أسوأ من السابق).

**2. recovery:pop يحذف قبل القرار (F5) ✅** — صار peek بلا حذف؛ المحو عند قرار صريح فقط (Restore/Discard → recoveryClear من الواجهة)؛ Escape/إغلاق-بلا-قرار يُبقي اللقطة لإعادة العرض في الإقلاع القادم، وwinClose لا يمحو أثناء حوار معلّق (`_recoveryPromptOpen`). اختبار main-side معدّل + اختبارا e2e جديدان.

**3. RTL-H3 ✅** — `pre{direction:ltr;text-align:start}` + `code{direction:ltr;unicode-bidi:isolate}` في HTML وEPUB export styles + اختباران.

**4. RTL-H4 ✅** — `renderCmBlock` يحسب `State.forcedDir || frontMatterDirection(الملف النشط)` (ودجات الجداول/المنبّهات تتبع front-matter أخيرًا) + هوية الودجة تشمل `dirKey` (eq يقارنها) + `setDirection` يرسل تحديدًا صريحًا متساويًا ليُعيد حساب facet الودجات فور التبديل. اختبار هوية وحدة + مسار CM6 الحقيقي في e2e أخضر.

**البوابات:** unit **108/2001** ✅ + e2e **849/849** ✅ + electron **23/23** ✅ + lint:security ✅ (216 مراجَعة: +3 detect-object-injection كلها حلقات فهرسة Buffer — نفس صنف الإيجابيات الكاذبة الموثقة، روجعت يدويًا) + Pester **34/34** ✅.

**5. بقايا dist + إعادة البناء** — نُظفت بقايا 1.0.1–1.3.0 والـ .7z وSHA256SUMS.txt (أسماء 1.0.0) وhwnd-verify.png وbuilder-debug.yml، وأُعيد بناء طقم 1.3.1 الكامل (NSIS multiarch + Portable multiarch + Inno x64 + source-manifest) من الكود الحالي. البنود 1–4 كلها داخل هذا البناء أخيرًا. التوقيع والتاغ والـ push = المالك.

# Chinese (Simplified) exercise-name glossary

Preferred terms keep the Chinese exercise-name pack consistent with how the
movements are named in Chinese-speaking gyms, and with the labels the zh UI
already shows. Equipment terms are taken from the equipment filter in
`frontend/src/locales/zh.js`, so the name on a card and the filter chip above
it say the same thing.

## The no-spaces rule

Chinese exercise names have **no spaces between words**: `杠铃卧推`, never
`杠铃 卧推`. This was raised by a native speaker on issue #419, and
`frontend/src/lib/zh-exercise-names.test.js` fails on any whitespace between
two Chinese characters. A space is only acceptable next to a Latin letter or
digit where it reads naturally, and even then avoid it if possible.

## Equipment

| English | Use in zh | Avoid |
|---|---|---|
| barbell | 杠铃 | 杆铃, 长杆 |
| dumbbell | 哑铃 | 啞鈴 (traditional) |
| ez barbell / ez bar | 曲杆杠铃 (曲杆 in compounds) | EZ杆, EZ杠 — a name must not start with a Latin capital, see Style |
| olympic barbell | 奥杆 | 奥林匹克杠铃 |
| trap bar | 六角杠 | 陷阱杠 |
| cable | 绳索 | 拉力器, 缆绳, 钢索 |
| rope (equipment) | 绳 | 绳子 |
| lever / leverage machine | 器械 as the name prefix (`器械推胸`); 杠杆器械 is the filter label | 杠杆机 |
| smith machine | 史密斯机 | 史密斯架, 史密斯器械 |
| kettlebell | 壶铃 | 铃铛 |
| band | 弹力带 | 皮筋, 带子 |
| resistance band | 阻力带 | 拉力带 |
| stability ball | 健身球 | 瑞士球, 稳定球 |
| bosu ball | 波速球 | 半球 |
| medicine ball | 药球 | 医疗球 |
| sled machine | 雪橇 | 雪橇机 |
| roller (foam) | 滚轴 | 泡沫棒 |
| wheel roller | 健腹轮 | 滚轮 |
| hammer | 锤 | 大锤 when the source says only hammer |
| tire | 轮胎 | 胎 |
| stationary bike | 动感单车 | 自行车 |
| elliptical machine | 椭圆机 | 漫步机 |
| skierg machine | 滑雪机 | SkiErg |
| stepmill machine | 爬楼机 | 楼梯机 |
| upper body ergometer | 上肢功率车 | 手摇车 |
| body weight | 自重 (only when the English title says it) | 徒手, 体重 |

## Movements

| English | Use in zh | Avoid |
|---|---|---|
| bench press | 卧推 | 板凳推举 |
| chest press | 推胸 | 胸推 |
| shoulder / overhead press | 肩推 / 推举 | 过头压 |
| military press | 军式推举 | 军事推 |
| row | 划船 | 拉 |
| bent-over row | 俯身划船 | 弯腰划船 |
| upright row | 直立划船 | 竖直拉 |
| pulldown / lat pulldown | 下拉 / 高位下拉 | 拉下 |
| pull-up | 引体向上 | 上拉 |
| chin-up | 反手引体向上 | 下巴上拉 |
| push-up | 俯卧撑 | 推起 |
| dip | 臂屈伸 (双杠臂屈伸 on parallel bars) | 下沉 |
| deadlift | 硬拉 | 死举 |
| romanian deadlift | 罗马尼亚硬拉 | 罗马硬拉 |
| stiff-leg deadlift | 直腿硬拉 | 僵腿硬拉 |
| sumo | 相扑 | 宽站 |
| squat | 深蹲 | 下蹲 (except where depth is literally partial) |
| front squat | 颈前深蹲 | 前深蹲 |
| hack squat | 哈克深蹲 | 黑客深蹲 |
| split squat | 分腿蹲 | 分开蹲 |
| lunge | 弓步蹲 | 箭步 |
| step-up | 登阶 | 上台阶 |
| curl (arm) | 弯举 | 卷曲 |
| hammer curl | 锤式弯举 | 锤子弯举 |
| preacher curl | 牧师凳弯举 | 传教士弯举 |
| concentration curl | 集中弯举 | 专注弯举 |
| leg curl | 腿弯举 | 腿卷 |
| triceps extension | 臂屈伸 / 三头肌臂屈伸 | 三头伸展 |
| skullcrusher | 仰卧臂屈伸 | 碎颅者 |
| pushdown | 下压 | 推下 |
| kickback (triceps) | 俯身臂屈伸 | 后踢 |
| leg extension | 腿屈伸 | 腿伸展 |
| back / hyperextension | 山羊挺身 | 超伸 |
| fly | 飞鸟 | 飞行 |
| lateral raise | 侧平举 | 侧举 |
| front raise | 前平举 | 前举 |
| rear delt fly / raise | 反向飞鸟 / 俯身飞鸟 | 后飞 |
| calf raise | 提踵 | 小腿抬 |
| shrug | 耸肩 | 耸 |
| crunch | 卷腹 | 仰卧卷 |
| sit-up | 仰卧起坐 | 坐起 |
| leg raise | 举腿 | 抬腿 (fine in prose, not in titles) |
| v-up | 两头起 | V字起坐 (starts with a Latin capital) |
| l-sit | 直角支撑 | L坐 |
| hip thrust | 臀推 | 髋推 |
| glute bridge | 臀桥 | 臀部桥 |
| good morning | 早安式体前屈 | 早安 |
| face pull | 面拉 | 脸拉 |
| pullover | 仰卧上拉 | 套头 |
| leg press | 腿举 | 推腿 |
| thruster | 火箭推 | 推进器 |
| burpee | 波比跳 | 波比 |
| plank | 平板支撑 | 木板 |
| side plank | 侧平板支撑 | 侧板 |
| jumping jack | 开合跳 | 跳跃杰克 |
| mountain climber | 登山跑 | 登山者 |
| russian twist | 俄罗斯转体 | 俄式扭转 |
| twist | 转体 | 扭 |
| snatch | 抓举 | 抢 |
| clean | 翻 / 高翻 (power clean) | 清洁 |
| clean and jerk | 挺举 | 清和挺 |
| swing (kettlebell) | 摆荡 | 摇摆 |
| farmer's walk | 农夫行走 | 农民走 |
| stretch | 拉伸 | 伸展运动 |

## Position, grip and qualifiers

| English | Use in zh | Avoid |
|---|---|---|
| seated | 坐姿 | 坐着 |
| standing | 站姿 | 站着 |
| lying (on back) | 仰卧 | 躺着 |
| lying (face down) / prone | 俯卧 | 趴着 |
| kneeling | 跪姿 | 跪着 |
| incline | 上斜 | 斜板, 斜上 |
| decline | 下斜 | 斜下, 反斜 |
| bent-over | 俯身 | 弯腰 |
| close grip | 窄握 | 近握 |
| wide grip | 宽握 | 广握 |
| reverse / underhand grip | 反握 | 反手握法 |
| overhand grip | 正握 | 正手握法 |
| neutral grip | 对握 | 中性握 |
| one arm / single arm | 单臂 | 一只手 |
| one leg / single leg | 单腿 | 一条腿 |
| alternate | 交替 | 轮流 |
| assisted | 辅助 | 协助 |
| self-assisted | 自我辅助 | 自助 |
| weighted | 负重 | 加重 |
| behind the neck | 颈后 | 脖子后 |
| (male) / (female) | （男） / （女） | （男性） / （女性） |
| v. 2 / version 2 | （第2版） | 版本二, v2 |

## Style

Simplified characters only — this is the `zh` (zh-CN) pack.

Keep the order the English title uses — equipment first, then the qualifiers
that describe the position, then the movement — the natural Chinese gym order
(`哑铃上斜卧推` for "dumbbell incline bench press"). Equipment first keeps the
list scannable beside the English original the app shows in parentheses.

No final full stop. Use full-width parentheses （） for qualifiers in Chinese
text and Arabic numerals for counts and angles (`45度`).

A name must not **start** with a Latin capital letter. The app decides whether
a pack is cased from how its names begin (`i18n-core.test.js`), and Chinese is
stored like the lower-case packs; a leading `EZ`, `L` or `V` would flip that
decision. Use the Chinese term from the tables above instead.

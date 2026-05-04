export interface LearningMethodEntry {
  id: string;
  titleEn: string;
  titleZh: string;
  summary: string;
  solves: string;
  scenario: string;
  href: string;
}

export const LEARNING_METHOD_ENTRIES: LearningMethodEntry[] = [
  {
    id: 'shadowing',
    titleEn: 'Shadowing',
    titleZh: '影子跟读',
    summary: '跟随音频同步输出，重建节奏与语调。',
    solves: '适合补语感、流畅度和连读重音。',
    scenario: '推荐在精听后做 10 到 20 秒短片段循环跟练。',
    href: '/learningtechniques#shadowing',
  },
  {
    id: 'echoing',
    titleEn: 'Echoing',
    titleZh: '回声跟读',
    summary: '延迟 1 到 2 秒再复述，强化听辨和短时记忆。',
    solves: '适合提升听辨、复述和关键信息抓取。',
    scenario: '推荐在一句一停的训练里和听写交替使用。',
    href: '/learningtechniques#echoing',
  },
  {
    id: 'dictation',
    titleEn: 'Dictation',
    titleZh: '听写',
    summary: '循环播放句子，边听边写，精确捕捉语音细节。',
    solves: '适合突破细节辨音、弱读连读和拼写问题。',
    scenario: '推荐短句精听时使用，先听后写，再核对复听。',
    href: '/learningtechniques#dictation',
  },
  {
    id: '100ls',
    titleEn: '100LS',
    titleZh: '百遍听',
    summary: '对 30 到 60 秒片段做超高频循环，形成听觉自动化。',
    solves: '适合提高熟悉度、耐受度和语音模式内化。',
    scenario: '推荐用一小段高质量片段做分段循环输入。',
    href: '/learningtechniques#100ls',
  },
  {
    id: 'chunk',
    titleEn: 'Chunk Listening',
    titleZh: '词块听力',
    summary: '以词块为单位吸收表达，再把输入转成可迁移输出。',
    solves: '适合提升听懂速度、搭配感和表达迁移。',
    scenario: '推荐在精听或复盘时标词块，再做替换练习。',
    href: '/learningtechniques#chunk',
  },
];

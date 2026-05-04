export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export type ScenarioCategory = 'episode' | 'general';

export interface Scenario {
  id: string;
  icon: string;
  name: string;
  description: string;
  level: Level;
  category: ScenarioCategory;
  episodeRef?: string;
  aiRole: string;
  aiName: string;
  systemPrompt: string;
  targetPhrases: string[];
  openingLine: string;
  openingTranslation?: string;
}

type ScenarioSeed = Omit<Scenario, 'systemPrompt'> & {
  systemPrompt?: string;
};

export const LEVEL_COLOR: Record<Level, string> = {
  A1: 'rgba(74,222,128,.12)',
  A2: 'rgba(74,222,128,.12)',
  B1: 'rgba(96,165,250,.12)',
  B2: 'rgba(96,165,250,.12)',
  C1: 'rgba(245,158,11,.12)',
};

export const LEVEL_TEXT_COLOR: Record<Level, string> = {
  A1: '#4ade80',
  A2: '#4ade80',
  B1: '#60a5fa',
  B2: '#60a5fa',
  C1: '#fbbf24',
};

function buildScenarioSystemPrompt(seed: ScenarioSeed): string {
  const phrases = seed.targetPhrases.filter(Boolean).slice(0, 6);
  const phraseHint =
    phrases.length > 0
      ? `Encourage the learner to naturally use expressions such as: ${phrases.join(', ')}.`
      : 'Encourage natural and clear spoken English in this conversation.';

  return [
    `You are ${seed.aiName}, acting as a ${seed.aiRole} in the scenario "${seed.name}".`,
    `Scenario goal: ${seed.description}.`,
    'Keep the conversation realistic, concise, and supportive for spoken English practice.',
    'Prefer natural responses over grammar explanations; if needed, model a better reply briefly.',
    phraseHint,
    'If the learner goes off-topic, gently guide the dialogue back to the scenario goal.',
  ].join(' ');
}

const SCENARIO_SEEDS: ScenarioSeed[] = [
  {
    id: 'hotel-checkin',
    icon: '🏨',
    name: '酒店入住对话',
    description: '练习向前台办理入住',
    level: 'B1',
    category: 'episode',
    episodeRef: '第06期',
    aiRole: '前台接待员',
    aiName: 'Echo',
    targetPhrases: ['reservation', 'deluxe double room', 'check-out date', 'city view', 'breakfast included', 'early check-in'],
    openingLine: 'Good afternoon! Welcome to The Grand Pacific Hotel. Do you have a reservation with us today?',
    openingTranslation: '下午好！欢迎来到太平洋大酒店。请问您今天有预订吗？',
  },
  {
    id: 'night-market',
    icon: '🌙',
    name: '夜市购物英语',
    description: '练习与摊贩英语讨价还价',
    level: 'B1',
    category: 'episode',
    episodeRef: '第07期',
    aiRole: '夜市摊贩',
    aiName: 'Echo',
    targetPhrases: ['How much is this?', 'Can you give me a discount?', "I'll take two", 'Do you have change?'],
    openingLine: "Hey there! Take a look. I've got some good deals tonight. What are you interested in?",
    openingTranslation: '嘿，来看看吧！今晚我这儿有不少划算的东西。你想看点什么？',
  },
  {
    id: 'metro-chat',
    icon: '🚇',
    name: '地铁通勤闲聊',
    description: '和陌生人练习日常闲聊',
    level: 'B2',
    category: 'episode',
    episodeRef: '第05期',
    aiRole: '地铁乘客',
    aiName: 'Echo',
    targetPhrases: ["How's your day going?", 'Which stop are you getting off?', 'Is this seat taken?'],
    openingLine: "Hi! This train is packed today, isn't it? Are you heading home or going somewhere else?",
    openingTranslation: '嗨！今天这趟地铁真挤，不是吗？你是回家还是去别的地方？',
  },
  {
    id: 'self-introduction',
    icon: '🙋',
    name: '自我介绍',
    description: '练习最基础的自我介绍',
    level: 'A1',
    category: 'general',
    aiRole: '新朋友',
    aiName: 'Echo',
    targetPhrases: ['My name is', 'I am from', 'I live in', 'I like'],
    openingLine: "Hi! Nice to meet you. Can you tell me your name and where you're from?",
    openingTranslation: '嗨！很高兴认识你。你可以告诉我你的名字和你来自哪里吗？',
  },
  {
    id: 'daily-greetings',
    icon: '👋',
    name: '日常打招呼',
    description: '练习最常见的问候表达',
    level: 'A1',
    category: 'general',
    aiRole: '邻居',
    aiName: 'Echo',
    targetPhrases: ['How are you?', "I'm fine", 'Nice to see you', 'Have a good day'],
    openingLine: 'Good morning! How are you today?',
    openingTranslation: '早上好！你今天怎么样？',
  },
  {
    id: 'coffee-order',
    icon: '☕',
    name: '咖啡馆点单',
    description: '练习点咖啡的日常英语',
    level: 'A2',
    category: 'general',
    aiRole: '咖啡师',
    aiName: 'Echo',
    targetPhrases: ["I'd like a...", 'What size?', 'For here or to go?', 'Can I get your name?'],
    openingLine: 'Hi there! Welcome in. What can I get for you today?',
    openingTranslation: '你好，欢迎光临。今天想喝点什么？',
  },
  {
    id: 'restaurant-order',
    icon: '🍽️',
    name: '餐厅点餐',
    description: '练习在餐厅点餐和询问菜单',
    level: 'A2',
    category: 'general',
    aiRole: '餐厅服务员',
    aiName: 'Echo',
    targetPhrases: ['Can I see the menu?', "I'd like to order", 'What do you recommend?', 'Can I have the bill?'],
    openingLine: 'Hello! Welcome to our restaurant. Are you ready to order, or would you like a few more minutes?',
    openingTranslation: '您好！欢迎光临我们的餐厅。您现在准备点餐了吗，还是还需要几分钟？',
  },
  {
    id: 'shopping-store',
    icon: '🛍️',
    name: '商店购物',
    description: '练习在商店里买东西',
    level: 'A2',
    category: 'general',
    aiRole: '店员',
    aiName: 'Echo',
    targetPhrases: ['How much is it?', 'Do you have this in blue?', 'Can I try it on?', "I'll take it"],
    openingLine: "Hi! Let me know if you need any help. What are you looking for today?",
    openingTranslation: '您好！如果需要帮助请告诉我。您今天想买什么？',
  },
  {
    id: 'asking-directions',
    icon: '🗺️',
    name: '问路',
    description: '练习向路人问路和确认方向',
    level: 'A2',
    category: 'general',
    aiRole: '路人',
    aiName: 'Echo',
    targetPhrases: ['Excuse me', 'How can I get to...?', 'Go straight', 'Turn left'],
    openingLine: 'Sure, I can help. Where are you trying to go?',
    openingTranslation: '当然，我可以帮忙。你想去哪里？',
  },
  {
    id: 'taxi-ride',
    icon: '🚕',
    name: '打车出行',
    description: '练习和司机沟通路线与费用',
    level: 'B1',
    category: 'general',
    aiRole: '出租车司机',
    aiName: 'Echo',
    targetPhrases: ['Please take me to', 'How long will it take?', 'Can you go faster?', 'Keep the change'],
    openingLine: 'Hi! Where would you like to go today?',
    openingTranslation: '您好！今天您想去哪里？',
  },
  {
    id: 'airport-checkin',
    icon: '🛫',
    name: '机场值机',
    description: '练习办理登机和值机托运',
    level: 'B1',
    category: 'general',
    aiRole: '值机柜台工作人员',
    aiName: 'Echo',
    targetPhrases: ["I'd like to check in", 'Here is my passport', 'Do I need to check this bag?', 'Can I have an aisle seat?'],
    openingLine: 'Good morning. Welcome to the check-in counter. May I see your passport, please?',
    openingTranslation: '早上好。欢迎来到值机柜台。请出示一下您的护照，好吗？',
  },
  {
    id: 'doctor-visit',
    icon: '🩺',
    name: '看医生',
    description: '练习描述症状和回答医生问题',
    level: 'B1',
    category: 'general',
    aiRole: '医生',
    aiName: 'Echo',
    targetPhrases: ['I have a headache', 'It started yesterday', 'I feel dizzy', 'What should I do?'],
    openingLine: "Hello, I'm Dr. Echo. What seems to be the problem today?",
    openingTranslation: '您好，我是 Echo 医生。今天哪里不舒服？',
  },
  {
    id: 'phone-appointment',
    icon: '📞',
    name: '电话预约',
    description: '练习打电话预约时间',
    level: 'B1',
    category: 'general',
    aiRole: '前台接线员',
    aiName: 'Echo',
    targetPhrases: ["I'd like to make an appointment", 'Is tomorrow available?', 'What time works for you?', 'That sounds good'],
    openingLine: 'Hello, this is the front desk. How may I help you?',
    openingTranslation: '您好，这里是前台。请问有什么可以帮您？',
  },
  {
    id: 'hotel-problem',
    icon: '🛎️',
    name: '酒店问题反馈',
    description: '练习投诉房间问题和请求帮助',
    level: 'B1',
    category: 'general',
    aiRole: '酒店前台',
    aiName: 'Echo',
    targetPhrases: ['There is a problem with my room', "The air conditioner isn't working", 'Can I change rooms?', 'Could someone help me?'],
    openingLine: "I'm sorry to hear that. Can you tell me what the problem is?",
    openingTranslation: '听到这个我很抱歉。您可以告诉我出了什么问题吗？',
  },
  {
    id: 'job-interview',
    icon: '💼',
    name: '工作面试',
    description: '练习英文面试中的常见问答',
    level: 'B2',
    category: 'general',
    aiRole: '面试官',
    aiName: 'Echo',
    targetPhrases: ['Tell me about yourself', 'My strengths are', 'I have experience in', "I'm interested in this role because"],
    openingLine: 'Thanks for joining us today. Could you start by telling me a little about yourself?',
    openingTranslation: '感谢你今天来参加面试。可以先简单介绍一下你自己吗？',
  },
  {
    id: 'meeting-discussion',
    icon: '🗂️',
    name: '会议讨论',
    description: '练习在工作会议中表达观点',
    level: 'B2',
    category: 'general',
    aiRole: '同事',
    aiName: 'Echo',
    targetPhrases: ['I think we should', "That's a good point", 'I agree with you', 'Maybe we could try'],
    openingLine: "Thanks, everyone. Let's begin. What do you think should be our top priority this week?",
    openingTranslation: '谢谢大家，我们开始吧。你觉得我们这周最优先的事情应该是什么？',
  },
  {
    id: 'small-talk-party',
    icon: '🎉',
    name: '聚会闲聊',
    description: '练习在聚会中轻松自然地聊天',
    level: 'B2',
    category: 'general',
    aiRole: '聚会上的新朋友',
    aiName: 'Echo',
    targetPhrases: ['How do you know the host?', 'What do you do?', "That's interesting", 'What do you do for fun?'],
    openingLine: "Hey, I don't think we've met before. I'm Echo. How do you know the host?",
    openingTranslation: '嘿，我觉得我们之前没见过。我是 Echo。你是怎么认识主人的？',
  },
  {
    id: 'project-presentation',
    icon: '📊',
    name: '项目汇报',
    description: '练习更正式、更清晰的项目表达',
    level: 'C1',
    category: 'general',
    aiRole: '经理',
    aiName: 'Echo',
    targetPhrases: "Here's a quick update,We've made progress on,One challenge we're facing is,Our next step is".split(','),
    openingLine: "Let's start with your update. Could you walk me through the current status of the project?",
    openingTranslation: '我们先听你的汇报。你可以带我过一下这个项目目前的进展吗？',
  },
  {
    id: 'opinion-discussion',
    icon: '🧠',
    name: '观点讨论',
    description: '练习更深入地表达观点和解释理由',
    level: 'C1',
    category: 'general',
    aiRole: '讨论伙伴',
    aiName: 'Echo',
    targetPhrases: ['In my opinion', 'On the one hand', 'A good example is', 'The main reason is'],
    openingLine: "Here's a topic for us to discuss: do you think technology is making communication better or worse?",
    openingTranslation: '我们来讨论一个话题：你觉得科技是在让沟通变得更好，还是更糟？',
  },
  {
    id: 'free-chat',
    icon: '💬',
    name: '随便聊',
    description: '无场景限制，随意用英语聊天',
    level: 'B1',
    category: 'general',
    aiRole: '英语母语朋友',
    aiName: 'Echo',
    targetPhrases: [],
    openingLine: "Hey! I'm ready to chat. What would you like to talk about today?",
    openingTranslation: '嗨！我准备好了。你今天想聊点什么？',
  },
];

export const SCENARIOS: Scenario[] = SCENARIO_SEEDS.map((seed) => ({
  ...seed,
  systemPrompt: seed.systemPrompt?.trim() || buildScenarioSystemPrompt(seed),
}));

import { isVocabularyAuthError } from './vocabulary';

export type VocabularyErrorContext =
  | 'dashboard_load'
  | 'today_plan_load'
  | 'today_plan_save'
  | 'notebook_load'
  | 'notebook_mutation'
  | 'report_update'
  | 'mistakes_update'
  | 'analysis_update';

const REQUEST_ERROR_MESSAGES: Record<VocabularyErrorContext, string> = {
  dashboard_load: '单词数据暂时无法加载，请稍后重试。',
  today_plan_load: '今日计划暂时无法加载，请稍后重试。',
  today_plan_save: '学习计划暂时无法保存，请稍后重试。',
  notebook_load: '词库数据暂时无法加载，请稍后重试。',
  notebook_mutation: '词条状态暂时没有更新成功，请稍后重试。',
  report_update: '学习报告暂时无法更新，请稍后重试。',
  mistakes_update: '错词分析暂时无法更新，请稍后重试。',
  analysis_update: '学习分析暂时无法更新，请稍后重试。',
};

const AUTH_ERROR_MESSAGES: Record<VocabularyErrorContext, string> = {
  dashboard_load: '登录状态已失效，请重新登录后继续查看单词数据。',
  today_plan_load: '登录状态已失效，请重新登录后继续查看今日计划。',
  today_plan_save: '登录状态已失效，请重新登录后再保存学习计划。',
  notebook_load: '登录状态已失效，请重新登录后继续查看词库。',
  notebook_mutation: '登录状态已失效，请重新登录后再更新词条状态。',
  report_update: '登录状态已失效，请重新登录后更新报告。',
  mistakes_update: '登录状态已失效，请重新登录后更新分析。',
  analysis_update: '登录状态已失效，请重新登录后更新分析。',
};

export function getVocabularyUserErrorMessage(error: unknown, context: VocabularyErrorContext) {
  if (isVocabularyAuthError(error)) {
    return AUTH_ERROR_MESSAGES[context];
  }

  return REQUEST_ERROR_MESSAGES[context];
}

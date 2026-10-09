import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { RULE_COACH_QUESTIONS, answerRuleCoach } from '../lib/rule-coach.js'
import '../coach.css'

export default function CoachChat() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [selected, setSelected] = useState('week')
  const answer = answerRuleCoach(S, selected)
  const question = RULE_COACH_QUESTIONS.find(q => q.id === selected)

  return <div className="narrow chat rule-coach">
    <div className="chat-hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="chat-av"><Icon name="sparkles" /></div>
      <div className="grow">
        <h1>{t('Coach')}</h1>
        <div className="chat-st">{t('Here when you need it')}</div>
      </div>
      <span className="rule-coach-local" title={t('Answers run on this device')}><Icon name="checkCircle" /></span>
    </div>

    <div className="msgs rule-coach-msgs">
      <div className="msg coach">
        <div className="bub">{t('Hi. I look at your actual training log and help you decide what to do next. Choose a question below — I’ll use your saved numbers and explain what they mean.')}</div>
      </div>

      <div className="rule-coach-prompt">
        <div className="rule-coach-section-label">{t('WHAT WOULD YOU LIKE TO KNOW?')}</div>
        <div className="chips-row rule-coach-chips">
          {RULE_COACH_QUESTIONS.map(q => <button key={q.id}
            className={'qchip' + (selected === q.id ? ' rule-coach-chip-on' : '')}
            aria-pressed={selected === q.id} onClick={() => setSelected(q.id)}>
            <Icon name={q.icon} />{t(q.title)}
          </button>)}
        </div>
      </div>

      {question && <div className="msg user rule-coach-user-question">
        <div className="bub">{t(question.title)}</div>
      </div>}

      {answer && <div className="msg coach rule-coach-response">
        <div className="pcard">
          <div className="pcard-hd">
            <div className="pcard-eyebrow">{t('YOUR TRAINING REVIEW')}</div>
            <h2 className="pcard-h">{t(answer.title)}</h2>
            {!!answer.summary && <p className="pcard-sum">{t(answer.summary)}</p>}
          </div>
          <div className="rule-coach-answer-lines">
            {answer.lines.map((line, i) => <div className="rule-coach-answer-line" key={i}>
              <span className="rule-coach-line-mark"><Icon name="check" /></span>
              <p>{t(line)}</p>
            </div>)}
          </div>
          {answer.action && <div className="rule-coach-action">
            <Button block onClick={() => nav(answer.action.route)}>{t(answer.action.label)} <Icon name="arrowRight" /></Button>
          </div>}
          <div className="rule-coach-foot">{t('Calculated from your saved records. No AI or API request.')}</div>
        </div>
      </div>}
    </div>

    <div className="rule-coach-bottom-note"><Icon name="shieldCheck" /> {t('If your log is missing information, I’ll say so instead of guessing.')}</div>
  </div>
}

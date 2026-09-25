import React from 'react';

// Cross-post switch between the media and prompt sections.
// ON: Instagram auto-shares to Facebook, so the Facebook card hides below
// and nothing posts twice. Choice persists for Stage 3.
export default function CrosspostToggle({ on, onChange }) {
  return (
    <div className="s2-cross">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Cross-post Instagram to Facebook"
        className={on ? 's2-switch on' : 's2-switch'}
        onClick={() => onChange(!on)}
      >
        <span aria-hidden="true" />
      </button>
      <div className="s2-cross-text">
        <b>Cross-post to Facebook</b>
        <small>
          {on
            ? 'On — Instagram auto-shares to Facebook. The Facebook card below is hidden.'
            : 'Off — Instagram and Facebook stay separate.'}
        </small>
      </div>
    </div>
  );
}

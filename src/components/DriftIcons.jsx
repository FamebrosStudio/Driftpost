import React from 'react';

// Signature Driftpost OG SVG Icon System — crisp geometric strokes with subtle secondary accents.
export function DriftIcon({ name, size = 16, className = '' }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: className ? `dp-icon ${className}` : 'dp-icon',
    'aria-hidden': 'true',
    focusable: 'false',
  };

  switch (name) {
    case 'home':
      return (
        <svg {...props}>
          <path d="M3.5 10.5 12 3.5l8.5 7" />
          <path d="M5.5 9.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10" />
          <path d="M10 20.5v-5.5a2 2 0 0 1 4 0v5.5" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" opacity="0.28" />
          <path d="M12 7.5v9M7.5 12h9" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...props}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
          <circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...props}>
          <path d="M4 19.5V4.5M4 19.5h16.5" />
          <path d="M7.5 15.5v-3.5M12 15.5V9M16.5 15.5V6.5" strokeWidth="2.1" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v4.8l3.2 2" />
        </svg>
      );
    case 'users':
      return (
        <svg {...props}>
          <circle cx="9.5" cy="8.5" r="3.2" />
          <path d="M3.5 19.5a6 6 0 0 1 12 0" />
          <circle cx="16.8" cy="9.2" r="2.3" opacity="0.75" />
          <path d="M17.5 14.5a4.5 4.5 0 0 1 3.5 4.5" opacity="0.75" />
        </svg>
      );
    case 'sliders':
      return (
        <svg {...props}>
          <path d="M4 6.5h10M18 6.5h2M4 12h4M12 12h8M4 17.5h10M18 17.5h2" />
          <circle cx="16" cy="6.5" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="16" cy="17.5" r="2" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...props}>
          <path d="M12 3.2l1.6 2 2.5-.5.8 2.4 2.4.8-.5 2.5 2 1.6-2 1.6.5 2.5-2.4.8-.8 2.4-2.5-.5-1.6 2-1.6-2-2.5.5-.8-2.4-2.4-.8.5-2.5-2-1.6 2-1.6-.5-2.5 2.4-.8.8-2.4 2.5.5Z" opacity="0.85" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'video':
    case 'film':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m10 9.2 5.2 2.8-5.2 2.8Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'photo':
      return (
        <svg {...props}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
          <circle cx="9" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
          <path d="m5.5 17 4.2-4.2a1.2 1.2 0 0 1 1.7 0l2.1 2.1 2-2a1.2 1.2 0 0 1 1.7 0l2.3 2.3" />
        </svg>
      );
    case 'review':
      return (
        <svg {...props}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5M7.8 10.5l1.9 2 3.6-3.8" />
        </svg>
      );
    case 'feed':
      return (
        <svg {...props}>
          <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
          <path d="M4.5 6v6c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V6" />
          <path d="M4.5 12v6c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-6" />
        </svg>
      );
    case 'arrowRight':
      return (
        <svg {...props}>
          <path d="M4.5 12h14.5M13.5 6.5 19 12l-5.5 5.5" />
        </svg>
      );
    case 'arrowLeft':
      return (
        <svg {...props}>
          <path d="M19.5 12H5M10.5 6.5 5 12l5.5 5.5" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2M12 19.5v2M5.28 5.28l1.41 1.41M17.31 17.31l1.41 1.41M2.5 12h2M19.5 12h2M5.28 18.72l1.41-1.41M17.31 6.69l1.41-1.41" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...props}>
          <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z" />
        </svg>
      );
    case 'signOut':
      return (
        <svg {...props}>
          <path d="M9.5 20.5h-4a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
          <path d="M16 16.5 20.5 12 16 7.5M20.5 12h-11" />
        </svg>
      );
    case 'moreGrid':
      return (
        <svg {...props}>
          <rect x="4" y="4" width="6.2" height="6.2" rx="1.8" />
          <rect x="13.8" y="4" width="6.2" height="6.2" rx="1.8" />
          <rect x="4" y="13.8" width="6.2" height="6.2" rx="1.8" />
          <rect x="13.8" y="13.8" width="6.2" height="6.2" rx="1.8" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...props}>
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.7" />
        </svg>
      );
    case 'crop':
      return (
        <svg {...props}>
          <path d="M6.5 3v12.5a2 2 0 0 0 2 2H21" />
          <path d="M3 6.5h12.5a2 2 0 0 1 2 2V21" />
        </svg>
      );
    case 'music':
      return (
        <svg {...props}>
          <path d="M9 17.5V6l10-2v11.5" />
          <circle cx="6.8" cy="17.5" r="2.3" />
          <circle cx="16.8" cy="15.5" r="2.3" />
        </svg>
      );
    case 'volumeOn':
      return (
        <svg {...props}>
          <path d="M4.5 9.5H8l4.5-3.8v12.6L8 14.5H4.5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
          <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
        </svg>
      );
    case 'volumeOff':
      return (
        <svg {...props}>
          <path d="M4.5 9.5H8l4.5-3.8v12.6L8 14.5H4.5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
          <path d="m16.5 9.5 4 5M20.5 9.5l-4 5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...props}>
          <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
        </svg>
      );
    case 'sparkles':
    default:
      return (
        <svg {...props}>
          <path d="m12 3 1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8L12 3Z" />
          <path d="m19 14.5.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" opacity="0.75" />
        </svg>
      );
  }
}

export default DriftIcon;

import React from 'react';
import clsx from 'clsx';

// An icon of the app's set (ui/src/assets/icons/, imported as a component by
// SVGR), drawn inline like the app's own Icon: the stroke stays 1 px at 16 px
// and below, 1.25 at 20 and 1.5 at 24 whatever the CSS size, and the colour
// follows the text. Sizes and stroke widths are in custom.css (.app-icon).
export default function AppIcon({svg: Svg, size = 16, className, label, ...rest}) {
  return (
    <Svg
      className={clsx('app-icon', `app-icon--${size}`, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
}

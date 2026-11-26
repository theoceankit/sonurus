import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/moon.svg';

// The app's moon icon in place of Docusaurus' own.
export default function IconDarkMode({className}) {
  return <AppIcon svg={Svg} size={20} className={className} />;
}

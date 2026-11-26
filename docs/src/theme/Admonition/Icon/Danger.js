import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/alert.svg';

// The app's alert icon in place of Docusaurus' own.
export default function AdmonitionIconDanger({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/lightbulb.svg';

// The app's lightbulb icon in place of Docusaurus' own.
export default function AdmonitionIconTip({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

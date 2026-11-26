import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/warning.svg';

// The app's warning icon in place of Docusaurus' own.
export default function AdmonitionIconWarning({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

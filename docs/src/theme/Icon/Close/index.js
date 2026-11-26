import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/close.svg';

// The app's close icon in place of Docusaurus' own.
export default function IconClose({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/copy.svg';

// The app's copy icon in place of Docusaurus' own.
export default function IconCopy({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

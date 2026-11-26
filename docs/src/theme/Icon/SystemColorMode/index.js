import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/system.svg';

// The app's system icon in place of Docusaurus' own.
export default function IconSystemColorMode({className}) {
  return <AppIcon svg={Svg} size={20} className={className} />;
}

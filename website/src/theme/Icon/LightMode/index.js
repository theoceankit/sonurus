import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/sun.svg';

// The app's sun icon in place of Docusaurus' own.
export default function IconLightMode({className}) {
  return <AppIcon svg={Svg} size={20} className={className} />;
}

import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/home.svg';

// The app's home icon in place of Docusaurus' own.
export default function IconHome({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/menu.svg';

// The app's menu icon in place of Docusaurus' own.
export default function IconMenu({className}) {
  return <AppIcon svg={Svg} size={20} className={className} />;
}

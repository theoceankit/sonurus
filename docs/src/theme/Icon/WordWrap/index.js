import React from 'react';
import AppIcon from '@site/src/components/AppIcon';
import Svg from '@site/../ui/src/assets/icons/wrap.svg';

// The app's wrap icon in place of Docusaurus' own.
export default function IconWordWrap({className}) {
  return <AppIcon svg={Svg} size={16} className={className} />;
}

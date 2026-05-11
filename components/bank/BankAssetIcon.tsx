import React from 'react';

export const isBankAssetUrl = (value?: string | null): value is string =>
    typeof value === 'string' && (
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('data:') ||
        value.startsWith('/')
    );

interface BankAssetIconProps {
    value?: string | null;
    alt?: string;
    imgClassName: string;
    textClassName: string;
}

const BankAssetIcon: React.FC<BankAssetIconProps> = ({
    value,
    alt = '',
    imgClassName,
    textClassName,
}) => {
    if (!value) return null;

    if (isBankAssetUrl(value)) {
        return <img src={value} alt={alt} className={imgClassName} draggable={false} />;
    }

    return <span className={textClassName}>{value}</span>;
};

export default BankAssetIcon;

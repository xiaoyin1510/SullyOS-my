import { Capacitor } from '@capacitor/core';

/**
 * 跨端取定位: 原生 (Capacitor) 走 @capacitor/geolocation 插件 (会弹原生权限申请),
 * 浏览器走 navigator.geolocation。
 *
 * 为什么需要: Capacitor 封装后 WebView 里的 navigator.geolocation 默认没有原生定位权限,
 * 直接报 "User denied geolocation"。必须用插件先 requestPermissions 弹窗申请, 再取位置。
 * (另外: 原生还需在 AndroidManifest 里声明 ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION,
 *  iOS 需在 Info.plist 加 NSLocationWhenInUseUsageDescription。)
 */
export interface GeoResult { longitude: number; latitude: number; accuracy: number; }

export const getCurrentPositionSmart = async (): Promise<GeoResult> => {
    // 原生: 用 Capacitor 插件 (弹权限)
    if (Capacitor.isNativePlatform()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        try {
            const perm = await Geolocation.checkPermissions();
            if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
                const req = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] as any });
                if (req.location !== 'granted' && (req as any).coarseLocation !== 'granted') {
                    throw new Error('定位权限被拒绝。请到 系统设置 → 应用 → 权限 里允许定位, 或直接选城市。');
                }
            }
        } catch (e: any) {
            // checkPermissions/requestPermissions 在个别机型会抛, 不阻塞, 直接尝试取位置
            console.warn('[geo] 权限检查异常, 继续尝试取位置:', e?.message || e);
        }
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        return { longitude: pos.coords.longitude, latitude: pos.coords.latitude, accuracy: pos.coords.accuracy ?? 99999 };
    }

    // 浏览器: navigator.geolocation
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        throw new Error('当前环境不支持定位, 请选城市或手输坐标');
    }
    return new Promise<GeoResult>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ longitude: pos.coords.longitude, latitude: pos.coords.latitude, accuracy: pos.coords.accuracy ?? 99999 }),
            (err) => reject(new Error(err.message || '定位失败')),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });
};

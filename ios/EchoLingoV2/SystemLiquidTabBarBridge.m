#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>

@interface RCT_EXTERN_MODULE(SystemLiquidTabBarManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(items, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectedIndex, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(accentColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(placement, NSString)
RCT_EXPORT_VIEW_PROPERTY(onTabPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMetricsChange, RCTBubblingEventBlock)
@end

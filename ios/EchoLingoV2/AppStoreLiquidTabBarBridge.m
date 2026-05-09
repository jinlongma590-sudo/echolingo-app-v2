#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>

@interface RCT_EXTERN_MODULE(AppStoreLiquidTabBarManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(items, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectedIndex, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(accentColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(placement, NSString)
RCT_EXPORT_VIEW_PROPERTY(onTabPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMetricsChange, RCTBubblingEventBlock)
@end

@interface RCT_EXTERN_MODULE(TopLiquidTabBarManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(items, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectedIndex, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(accentColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(placement, NSString)
RCT_EXPORT_VIEW_PROPERTY(onTabPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMetricsChange, RCTBubblingEventBlock)
@end

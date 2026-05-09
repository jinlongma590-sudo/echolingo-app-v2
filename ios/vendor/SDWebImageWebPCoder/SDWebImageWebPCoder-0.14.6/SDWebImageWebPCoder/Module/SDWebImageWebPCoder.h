#ifdef __OBJC__
#else
#ifndef FOUNDATION_EXPORT
#if defined(__cplusplus)
#define FOUNDATION_EXPORT extern "C"
#else
#define FOUNDATION_EXPORT extern
#endif
#endif
#endif

#import <SDWebImageWebPCoder/SDImageWebPCoder.h>
#import <SDWebImageWebPCoder/SDWebImageWebPCoderDefine.h>
#import <SDWebImageWebPCoder/UIImage+WebP.h>

FOUNDATION_EXPORT double SDWebImageWebPCoderVersionNumber;
FOUNDATION_EXPORT const unsigned char SDWebImageWebPCoderVersionString[];

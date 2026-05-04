import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { NativeTabBarAdapter } from '@/navigation/native/NativeTabBarAdapter';
import { BG_PAGE } from '@/theme/tokens';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconsName) {
  return ({ color }: { color: string }) => <Ionicons name={name} size={25} color={color} />;
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: BG_PAGE }}>
      <Tabs
        tabBar={(props) => <NativeTabBarAdapter {...props} />}
        screenOptions={{
          headerShown: false,
          // Android: 清除 React Navigation 对 tabBar 容器默认添加的 elevation:8 背景和阴影
          // iOS: 无 elevation，shadow 由 AppStoreGlassTabBar 自己控制，这里不影响
          tabBarStyle: {
            backgroundColor: 'transparent',
            elevation: 0,
            borderTopWidth: 0,
          },
          sceneStyle: {
            backgroundColor: BG_PAGE,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: '首页',
            tabBarIcon: tabIcon('home'),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: '精听',
            tabBarIcon: tabIcon('headset'),
          }}
        />
        <Tabs.Screen
          name="words"
          options={{
            title: '单词',
            tabBarIcon: tabIcon('grid'),
          }}
        />
        <Tabs.Screen
          name="speaking"
          options={{
            title: '口语',
            tabBarIcon: tabIcon('mic'),
          }}
        />
        <Tabs.Screen
          name="my"
          options={{
            title: '我的',
            tabBarIcon: tabIcon('person'),
          }}
        />
      </Tabs>
    </View>
  );
}

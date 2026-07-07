<script setup lang="ts">
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { getPlatformAdmin } from '@/utils/storage';

const router = useRouter();
const admin = getPlatformAdmin();

function goRecommendations() {
  router.push('/platform/recommendations');
}

function goOrders() {
  router.push('/platform/orders');
}

function goBusinessTypes() {
  router.push('/platform/merchant-types');
}

function goPromotionTags() {
  router.push('/platform/promotion-tags');
}
</script>

<template>
  <section>
    <PageHeader
      title="系统设置"
      description="查看平台基础配置、运营规则和数据统计口径"
    />

    <section class="platform-settings-grid">
      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>平台基础信息</h2>
          <span class="badge success">运行中</span>
        </div>
        <dl class="detail-list settings-detail-list">
          <dt>平台名称</dt><dd>云桥 Life</dd>
          <dt>业务模式</dt><dd>到店扫码点餐 / 到店自取 / 商家配送</dd>
          <dt>当前版本</dt><dd>MVP</dd>
          <dt>运营区域</dt><dd>北江 / 北宁</dd>
          <dt>平台状态</dt><dd>运行中</dd>
        </dl>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>首页推荐规则</h2>
          <button class="secondary small" @click="goRecommendations">前往首页推荐</button>
        </div>
        <div class="settings-rule-list">
          <div>
            <strong>热门推荐 HOT_FOOD</strong>
            <p>当前日常运营主用推荐标签</p>
          </div>
          <div>
            <strong>中式正餐</strong>
            <p>商家首页分类 chinese_dining</p>
          </div>
          <div>
            <strong>粉面小吃</strong>
            <p>商家首页分类 noodles_snacks</p>
          </div>
          <div>
            <strong>咖啡奶茶</strong>
            <p>商家首页分类 coffee_milk_tea</p>
          </div>
        </div>
        <p class="hint">
          如需调整首页推荐或分类入口，请前往“首页推荐”或“商家管理”。
        </p>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>高级配置</h2>
          <span class="badge muted">系统配置</span>
        </div>
        <div class="settings-rule-list">
          <div>
            <strong>商家类型配置</strong>
            <p>管理平台可选经营类型和默认能力</p>
          </div>
          <div>
            <strong>推荐标签配置</strong>
            <p>管理 HOT_FOOD 等首页推荐标签</p>
          </div>
        </div>
        <div class="settings-reserve-actions">
          <button class="secondary" @click="goBusinessTypes">商家类型配置</button>
          <button class="secondary" @click="goPromotionTags">推荐标签配置</button>
        </div>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>订单规则说明</h2>
          <span class="badge muted">说明</span>
        </div>
        <div class="settings-rule-list">
          <div>
            <strong>支持订单类型</strong>
            <p>到店扫码点餐 / 到店自取 / 商家配送</p>
          </div>
          <div>
            <strong>当前订单金额口径</strong>
            <p>订单金额 = 用户下单时的商品金额 + 配送费等订单字段合计</p>
          </div>
        </div>
        <p class="hint">当前未接在线支付，订单金额不等于在线支付金额。</p>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>数据统计口径</h2>
          <button class="secondary small" @click="goOrders">前往订单管理</button>
        </div>
        <div class="settings-rule-list">
          <div><strong>今日订单</strong><p>按服务器日期统计今日订单数量</p></div>
          <div><strong>今日订单金额</strong><p>今日订单 totalAmount 合计</p></div>
          <div><strong>近 7 日订单</strong><p>最近 7 天订单数量</p></div>
          <div><strong>完成率</strong><p>已完成订单 / 非取消订单</p></div>
          <div><strong>取消率</strong><p>已取消订单 / 总订单数</p></div>
          <div><strong>客单价</strong><p>订单金额 / 订单数</p></div>
        </div>
        <p class="hint">数据用于运营参考，如需核对，请前往“订单管理”。</p>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>平台管理员</h2>
          <span class="badge success">已登录</span>
        </div>
        <dl class="detail-list settings-detail-list">
          <dt>账号名称</dt><dd>{{ admin?.username || '当前平台管理员' }}</dd>
          <dt>登录来源</dt><dd>平台后台本地会话</dd>
          <dt>权限范围</dt><dd>平台运营管理</dd>
        </dl>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>系统状态</h2>
          <span class="badge success">说明</span>
        </div>
        <div class="settings-rule-list">
          <div><strong>API 服务</strong><p>运行中</p></div>
          <div><strong>后台前端</strong><p>运行中</p></div>
          <div><strong>数据来源</strong><p>真实订单 / 商家 / 用户数据</p></div>
          <div><strong>支付状态</strong><p>未接入在线支付</p></div>
          <div><strong>小程序状态</strong><p>已接入基础点餐流程</p></div>
        </div>
      </article>

      <article class="card platform-settings-card">
        <div class="section-heading">
          <h2>后续配置预留</h2>
          <span class="badge muted">后续开放</span>
        </div>
        <div class="settings-reserve-list">
          <span>平台公告</span>
          <span>默认配送提示</span>
          <span>城市运营配置</span>
          <span>商家审核开关</span>
          <span>数据导出</span>
          <span>管理员权限</span>
        </div>
        <div class="settings-reserve-actions">
          <button class="secondary" disabled>后续开放</button>
          <button class="secondary" disabled>后续开放</button>
          <button class="secondary" disabled>后续开放</button>
        </div>
      </article>
    </section>
  </section>
</template>

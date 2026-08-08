import postgres from "postgres";
import dotenv from "dotenv";
import { randomBytes, scrypt } from "node:crypto";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

const hashPassword = async (password) => {
  const salt = randomBytes(16);
  const derivedKey = await new Promise((resolve, reject) => {
    scrypt(password, salt, 64, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
  return [
    "scrypt",
    16_384,
    8,
    1,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
};

async function seedData() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    console.log("开始插入模拟数据...");

    const seedEmail = (process.env.SEED_USER_EMAIL || "demo@example.com").trim().toLowerCase();
    const generatedPassword = !process.env.SEED_USER_PASSWORD;
    const seedPassword = process.env.SEED_USER_PASSWORD || randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(seedPassword);

    const [seedUser] = await sql`
      INSERT INTO users (name, email, role, "lastSignedIn")
      VALUES (${ "示例用户" }, ${ seedEmail }, ${ "user" }, now())
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        "updatedAt" = now()
      RETURNING id
    `;
    const seedUserId = seedUser.id;

    // Every account owns exactly one workspace; seeded data hangs off it.
    const [seedWorkspace] = await sql`
      INSERT INTO workspaces ("ownerUserId", name, "publicKey", "agentName", "businessContext", "onboardingStep", "onboardingCompletedAt")
      VALUES (
        ${seedUserId},
        ${"示例用户 的客服"},
        ${randomBytes(12).toString("hex")},
        ${"小满助手"},
        ${"示例电商店铺，销售数码配件，客户最常问物流、退货和保修。"},
        ${"done"},
        now()
      )
      ON CONFLICT ("ownerUserId") DO UPDATE SET
        "agentName" = EXCLUDED."agentName",
        "updatedAt" = now()
      RETURNING id
    `;
    const seedWorkspaceId = seedWorkspace.id;
    await sql`
      INSERT INTO workspace_channels ("workspaceId", provider, status, "displayName", "webhookSecret")
      VALUES (${seedWorkspaceId}, ${"web"}, ${"connected"}, ${"分享链接"}, ${randomBytes(16).toString("hex")})
      ON CONFLICT ("workspaceId", provider) DO NOTHING
    `;
    console.log(`已准备示例工作区，ID: ${seedWorkspaceId}`);
    await sql`
      INSERT INTO auth_accounts ("userId", provider, "providerAccountId", "passwordHash")
      VALUES (${ seedUserId }, ${ "password" }, ${ seedEmail }, ${ passwordHash })
      ON CONFLICT (provider, "providerAccountId") DO UPDATE SET
        "userId" = EXCLUDED."userId",
        "passwordHash" = EXCLUDED."passwordHash",
        "updatedAt" = now()
    `;
    console.log(`已准备示例用户，ID: ${seedUserId}`);
    console.log(`示例用户邮箱: ${seedEmail}`);
    if (generatedPassword) {
      console.log(`本次生成的示例用户密码: ${seedPassword}`);
    }

    const knowledgeData = [
      {
        title: "如何重置密码？",
        content: "您可以通过以下步骤重置密码：1. 点击登录页面的忘记密码链接；2. 输入您的注册邮箱；3. 检查邮件中的重置链接；4. 点击链接并设置新密码。如果您没有收到邮件，请检查垃圾邮件文件夹。",
        category: "FAQ",
        keywords: "密码,重置,登录,忘记密码",
      },
      {
        title: "产品退货政策",
        content: "我们提供30天内无条件退货服务。退货条件：1. 商品必须处于原始状态，未使用或未损坏；2. 需要保留原始包装和所有配件；3. 请在收货后30天内申请退货；4. 退货运费由客户承担。退货批准后，我们将在7个工作日内处理退款。",
        category: "政策",
        keywords: "退货,退款,政策,返回",
      },
      {
        title: "如何联系客服？",
        content: "您可以通过以下方式联系我们的客服团队：1. 在线聊天：工作时间 9:00-18:00（周一至周五）；2. 邮件：support@example.com；3. 电话：400-123-4567；4. 社交媒体：微博、微信公众号。平均响应时间为2小时。",
        category: "联系方式",
        keywords: "客服,联系,支持,帮助",
      },
      {
        title: "产品保修期是多久？",
        content: "我们的产品提供1年的有限保修。保修覆盖范围：1. 制造缺陷导致的故障；2. 正常使用中的硬件损坏。不包括：1. 人为损坏或误用；2. 自然磨损；3. 未经授权的维修。保修期内，我们提供免费维修或更换服务。",
        category: "保修",
        keywords: "保修,保障,维修,损坏",
      },
      {
        title: "如何升级我的账户？",
        content: "升级账户步骤：1. 登录您的账户；2. 进入账户设置；3. 选择升级计划；4. 选择您想要的计划类型；5. 完成支付。升级后立即生效，您可以享受更多功能和优先支持。",
        category: "账户",
        keywords: "升级,计划,功能,付费",
      },
      {
        title: "产品兼容性问题",
        content: "我们的产品兼容以下系统：1. Windows 7及以上版本；2. macOS 10.12及以上版本；3. iOS 10及以上版本；4. Android 5.0及以上版本。如果您遇到兼容性问题，请确保您的系统已更新到最新版本，或联系我们的技术支持。",
        category: "技术",
        keywords: "兼容,系统,版本,支持",
      },
      {
        title: "如何使用优惠券？",
        content: "使用优惠券步骤：1. 在购物车页面找到优惠券输入框；2. 输入您的优惠券代码；3. 点击应用按钮；4. 优惠将自动计算。每个订单只能使用一张优惠券。优惠券不可与其他促销活动叠加使用。",
        category: "促销",
        keywords: "优惠,折扣,优惠券,代码",
      },
      {
        title: "订单发货时间",
        content: "订单发货时间：1. 订单确认后，我们通常在1-2个工作日内发货；2. 标准快递：3-5个工作日送达；3. 特快快递：1-2个工作日送达；4. 国际订单：7-15个工作日。您可以在订单页面查看实时物流信息。",
        category: "物流",
        keywords: "发货,快递,物流,时间",
      },
    ];

    for (const kb of knowledgeData) {
      const [existingEntry] = await sql`
        SELECT id FROM knowledge_base
        WHERE "workspaceId" = ${seedWorkspaceId} AND title = ${kb.title}
        LIMIT 1
      `;
      if (existingEntry) {
        await sql`
          UPDATE knowledge_base SET
            content = ${kb.content},
            category = ${kb.category},
            keywords = ${kb.keywords},
            embedding = NULL,
            "embeddingStatus" = 'pending',
            "updatedAt" = now()
          WHERE id = ${existingEntry.id}
        `;
      } else {
        await sql`
          INSERT INTO knowledge_base ("workspaceId", title, content, category, keywords)
          VALUES (${seedWorkspaceId}, ${kb.title}, ${kb.content}, ${kb.category}, ${kb.keywords})
        `;
      }
    }
    console.log(`已准备 ${knowledgeData.length} 条知识库数据`);

    const ticketData = [
      {
        userId: seedUserId,
        title: "无法登录账户",
        description: "我已经尝试了多次，但仍然无法使用我的账户登录。每次输入正确的密码后，系统都会显示登录失败的错误。我已经检查了大小写，也确认密码是正确的。",
        status: "pending",
        priority: "high",
      },
      {
        userId: seedUserId,
        title: "产品质量问题",
        description: "我收到的产品存在明显的质量问题。包装盒有破损，产品表面有划痕。这不是我期望的产品质量。请告诉我如何处理这个问题。",
        status: "in_progress",
        priority: "urgent",
      },
      {
        userId: seedUserId,
        title: "退款申请",
        description: "我想退回我在上周购买的产品。产品没有按照描述工作，我想申请退款。请告诉我退款流程。",
        status: "resolved",
        priority: "medium",
      },
      {
        userId: seedUserId,
        title: "功能使用问题",
        description: "我不太清楚如何使用高级功能。能否提供一些教程或指导？",
        status: "closed",
        priority: "low",
      },
      {
        userId: seedUserId,
        title: "账户被锁定",
        description: "我的账户似乎被锁定了。我尝试了多次登录，现在系统说我的账户已被暂时锁定。我需要立即恢复访问权限。",
        status: "pending",
        priority: "urgent",
      },
    ];

    const [{ count: existingTicketCount }] = await sql`
      SELECT COUNT(*)::int AS count FROM tickets WHERE "workspaceId" = ${seedWorkspaceId}
    `;
    if (existingTicketCount === 0) {
      for (const ticket of ticketData) {
        await sql`
          INSERT INTO tickets ("workspaceId", "userId", title, description, status, priority)
          VALUES (${seedWorkspaceId}, ${ticket.userId}, ${ticket.title}, ${ticket.description}, ${ticket.status}, ${ticket.priority})
        `;
      }
      console.log(`已插入 ${ticketData.length} 条工单数据`);
    } else {
      console.log("已存在示例工单，跳过工单插入");
    }

    const noteData = [
      {
        ticketId: 1,
        userId: seedUserId,
        content: "我已经尝试了重置密码，但问题仍然存在。",
        noteType: "comment",
      },
      {
        ticketId: 2,
        userId: seedUserId,
        content: "已拍照记录，准备申请退货。",
        noteType: "comment",
      },
      {
        ticketId: 3,
        userId: seedUserId,
        content: "已确认退货地址，等待收货。",
        noteType: "comment",
      },
      {
        ticketId: 3,
        userId: seedUserId,
        content: "Status changed from in_progress to resolved",
        noteType: "status_change",
      },
    ];

    const [{ count: existingNoteCount }] = await sql`
      SELECT COUNT(*)::int AS count FROM ticket_notes WHERE "userId" = ${seedUserId}
    `;
    if (existingNoteCount === 0) {
      for (const note of noteData) {
        await sql`
          INSERT INTO ticket_notes ("ticketId", "userId", content, "noteType")
          VALUES (${note.ticketId}, ${note.userId}, ${note.content}, ${note.noteType})
        `;
      }
      console.log(`已插入 ${noteData.length} 条工单备注数据`);
    } else {
      console.log("已存在示例工单备注，跳过备注插入");
    }

    console.log("\n数据初始化完成！");
  } catch (error) {
    console.error("数据初始化失败:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

seedData();

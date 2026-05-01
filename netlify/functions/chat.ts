import Groq from "groq-sdk";

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const { messages } = JSON.parse(event.body);

    const completion = await groq.chat.completions.create({
      messages,
      model: "llama-3.3-70b-versatile",
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: completion.choices[0]?.message?.content || "" }),
    };
  } catch (error: any) {
    console.error("Groq API Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

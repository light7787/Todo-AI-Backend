import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cors from 'cors';    // Import cors for handling CORS issues
import { handleAiPrompt } from './gemini.js'; // Include .js extension

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors({
  origin: '*', // Allows requests from any origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
   credentials: true 

}));

const supabaseUrl =  process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function CreateTodo(req,res){
    const { task } = req.body;

    if (!task) {
        return res.status(400).json({ error: 'Title and description are required' });
    }

    const { data, error } = await supabase
        .from('todos')
        .insert([{ task}])
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data[0]);


}

export async function GetTodos(req, res) {
    try {
        const { data, error } = await supabase
            .from('todos')
            .select('*');
        
        if (error) {
            if (res) return res.status(500).json({ error: error.message });
            throw error;
        }
        
        if (res) return res.status(200).json(data);
        return data;
    } catch (err) {
        console.error('Error in GetTodos:', err);
        if (res) return res.status(500).json({ error: err.message });
        throw err;
    }
}

export async function UpdateTodo(req,res){
    const { id } = req.params;
    const { done } = req.body;

    console.log('Updating id:', id, 'with done:', done);

    const { data, error } = await supabase
      .from('todos')
      .update({ done })
      .eq('id', id)
      .select();

    console.log('Update result:', data, error);

    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
}


export async function DeleteTodo(req,res){
    const { id } = req.params;

    const { data, error } = await supabase
        .from('todos')
        .delete()
        .eq('id', id)
        .select();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);

}

app.post('/todos', CreateTodo);
app.get('/todos', GetTodos);
app.put('/todos/:id', UpdateTodo);
app.delete('/todos/:id', DeleteTodo);
app.post('/ai', handleAiPrompt);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
